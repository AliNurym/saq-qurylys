const select=`SELECT o.id,o.complex_id AS complexId,o.observed_date AS observedDate,o.completion_pct AS completionPercentage,
  o.source,o.method,o.description,o.supersedes_id AS supersedesId,o.mime,o.sha256,o.width,o.height,o.created_at AS createdAt,o.created_by AS createdBy,
  r.status,r.reason AS reviewReason,r.applied,r.reviewed_at AS reviewedAt,r.reviewed_by AS reviewedBy,
  (SELECT n.id FROM construction_observations n JOIN construction_reviews d ON d.observation_id=n.id AND d.status='CONFIRMED' WHERE n.supersedes_id=o.id LIMIT 1) AS supersededBy
  FROM construction_observations o LEFT JOIN construction_reviews r ON r.observation_id=o.id`;
const serialize=row=>row?{...row,status:row.status??'PENDING',applied:Boolean(row.applied),photoUrl:'/api/complexes/'+encodeURIComponent(row.complexId)+'/observations/'+encodeURIComponent(row.id)+'/photo'}:null;
export function getConstructionObservation(db,complexId,id) {return serialize(db.prepare(select+' WHERE o.complex_id=? AND o.id=?').get(complexId,id));}
export function getConstructionPhoto(db,complexId,id) {return db.prepare('SELECT mime,sha256,width,height,bytes FROM construction_observations WHERE complex_id=? AND id=?').get(complexId,id)??null;}

export function listConstructionObservations(db,complexId,{limit=50,before=null}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(new Error('Фотоотчёты: limit от 1 до 100.'),{statusCode:400});
  let cursor=null;
  if(before) {cursor=db.prepare('SELECT observed_date,created_at,id FROM construction_observations WHERE complex_id=? AND id=?').get(complexId,before);if(!cursor)throw Object.assign(new Error('Курсор фотоотчётов не найден.'),{statusCode:400});}
  const where=cursor?' AND (o.observed_date,o.created_at,o.id)<(?,?,?)':'';
  const rows=db.prepare(select+' WHERE o.complex_id=?'+where+' ORDER BY o.observed_date DESC,o.created_at DESC,o.id DESC LIMIT ?').all(complexId,...(cursor?[cursor.observed_date,cursor.created_at,cursor.id]:[]),limit+1);
  const items=rows.slice(0,limit).map(serialize);
  return {items,total:db.prepare('SELECT count(*) AS n FROM construction_observations WHERE complex_id=?').get(complexId).n,nextCursor:rows.length>limit?items.at(-1).id:null};
}

export function getConstructionTrend(db,complexId) {
  const rows=db.prepare(select+" WHERE o.complex_id=? AND r.status='CONFIRMED' ORDER BY o.observed_date DESC,r.reviewed_at DESC,o.id DESC").all(complexId).map(serialize);
  const all=rows.filter(row=>!row.supersededBy).reverse();
  const valuesByDate=new Map();
  for(const row of all) {if(!valuesByDate.has(row.observedDate))valuesByDate.set(row.observedDate,new Set());valuesByDate.get(row.observedDate).add(row.completionPercentage);}
  const conflict=date=>valuesByDate.get(date).size>1;
  const points=all.map((row,index,array)=>({observationId:row.id,date:row.observedDate,percentage:row.completionPercentage,applied:row.applied,
    changePercentagePoints:index&&row.observedDate!==array[index-1].observedDate&&!conflict(row.observedDate)&&!conflict(array[index-1].observedDate)?row.completionPercentage-array[index-1].completionPercentage:null,
    sameDayConflict:conflict(row.observedDate),method:row.method,source:row.source})).slice(-50);
  return {points,totalPoints:all.length,totalDates:new Set(all.map(row=>row.observedDate)).size,truncated:all.length>points.length,method:'HUMAN_REVIEWED_MEASUREMENTS'};
}

export function getConstructionSnapshot(db,complexId) {
  const row=db.prepare('SELECT verified_observation_id FROM complexes WHERE id=?').get(complexId);
  const active=row?.verified_observation_id?getConstructionObservation(db,complexId,row.verified_observation_id):null;
  if(active)active.photoData=Buffer.from(getConstructionPhoto(db,complexId,active.id).bytes).toString('base64');
  const history=db.prepare('SELECT kind,percentage,source,captured_at AS capturedAt,observation_id AS observationId,revision,reason,created_at AS createdAt,created_by AS createdBy FROM readiness_history WHERE complex_id=? ORDER BY revision DESC LIMIT 50').all(complexId);
  const total=db.prepare('SELECT count(*) AS n FROM readiness_history WHERE complex_id=?').get(complexId).n;
  return {activeObservation:active,trend:getConstructionTrend(db,complexId),readinessHistory:{items:history,total,truncated:total>history.length}};
}
