export function getCollectionProvenance(db,adId) {
  const row=db.prepare(`SELECT p.external_id AS externalId,p.published_at AS publishedAt,p.observed_at AS observedAt,
    p.archive_id AS archiveId,p.content_sha256 AS contentSha256,
    json_extract(a.source_snapshot_json,'$.name') AS sourceName,json_extract(a.source_snapshot_json,'$.kind') AS sourceKind,
    a.mime,a.sha256,a.captured_at AS capturedAt,a.final_url AS storedFinalUrl,json_extract(a.source_snapshot_json,'$.capture') AS page_capture_json
    FROM collected_publications p JOIN source_archives a ON a.id=p.archive_id WHERE p.advertisement_id=?`).get(adId)??null;
  if(!row)return null;const {page_capture_json,storedFinalUrl,...result}=row;let sourceOrigin=null;try{sourceOrigin=new URL(storedFinalUrl).origin;}catch{}
  const pageCapture=page_capture_json?JSON.parse(page_capture_json):null;
  if(pageCapture?.provenance) {
    const provenance=pageCapture.provenance;let rootOrigin=provenance.rootOrigin;
    if(!rootOrigin&&typeof provenance.rootUrl==='string')try{rootOrigin=new URL(provenance.rootUrl).origin;}catch{}
    pageCapture.provenance={...provenance,rootOrigin,assets:[]};delete pageCapture.provenance.rootUrl;
  }
  return {...result,sourceOrigin,pageCapture};
}
export function getAdvertisementArchive(db,adId) {
  return db.prepare('SELECT a.* FROM source_archives a JOIN collected_publications p ON p.archive_id=a.id WHERE p.advertisement_id=?').get(adId)??null;
}
export function getJobArchive(db,jobId) {
  return db.prepare("SELECT a.* FROM background_jobs j JOIN source_archives a ON a.job_id=j.id AND a.id=json_extract(j.result_json,'$.archiveId') WHERE j.id=? AND j.state='SUCCEEDED' AND j.kind='COLLECT_SOURCE'").get(jobId)??null;
}
