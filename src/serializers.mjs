import {redactCredentialQueryParameters} from './public-http.mjs';

export function serializeComplex(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    objectNumber: row.object_number,
    passport: JSON.parse(row.passport_json || "{}"),
    city: row.city,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    developerName: row.developer_name,
    developerBin: row.developer_bin,
    constructionStage: row.construction_stage,
    commissioningStatus: row.commissioning_status,
    declaredCompletionPercentage: row.declared_completion_pct,
    declaredCompletionSource: row.declared_completion_source,
    declaredCompletionCapturedAt: row.declared_completion_at,
    verifiedCompletionPercentage: row.verified_completion_pct,
    verifiedCompletionSource: row.verified_completion_source,
    verifiedCompletionCapturedAt: row.verified_completion_at,
    verifiedObservationId:row.verified_observation_id??null,
    readinessRevision:row.readiness_revision??0,
    legalBasisType: row.legal_basis_type,
    legalBasisStatus: row.legal_basis_status,
    legalBasisSource: row.legal_basis_source,
    legalBasisCheckedAt: row.legal_basis_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDemo: Boolean(row.is_demo),
  };
}
export function serializeAdvertisement(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    account: row.account,
    phone: row.phone,
    publicationDate: row.publication_date,
    url: row.url?redactCredentialQueryParameters(row.url):null,
    text: row.text,
    screenshotPath: row.screenshot_path,
    sourceStatus: row.source_status ?? "CAPTURED",
    sourceRemovedAt: row.source_removed_at,
    notes: row.notes,
    capturedAt: row.captured_at,
    complexId: row.complex_id,
    proposedComplexId: row.suggested_complex_id,
    linkStatus: row.link_status,
    isDemo: Boolean(row.is_demo),
    createdAt: row.created_at,
  };
}

export function serializeFactor(row) {
  if (!row) return null;
  return {
    context:row.context_json?JSON.parse(row.context_json):null,
    id: row.id,
    complexId: row.complex_id,
    code: row.code,
    weight: row.weight,
    status: row.status,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceLabel: row.source_label,
    evidenceText: row.evidence_text,
    confidence: row.confidence,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    notes: row.notes,
    isDemo: Boolean(row.is_demo),
    createdAt: row.created_at,
  };
}

export function serializeSignal(row) {
  if (!row) return null;
  const routing = JSON.parse(row.routing_json || "{}");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    id: row.id,
    complexId: row.complex_id,
    scoreSnapshot: row.score_snapshot,
    zoneSnapshot: row.zone_snapshot,
    legalBasisSnapshot: row.legal_basis_snapshot,
    factorSnapshot: JSON.parse(row.factor_snapshot_json),
    contextSnapshot: row.context_snapshot_json ? JSON.parse(row.context_snapshot_json) : null,
    legacySnapshot: !row.context_snapshot_json,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    comment: row.comment,
    routing,
    overdue: Boolean(row.status==='CONFIRMED' && routing.assignedAt && routing.dueDate && !routing.result && routing.dueDate < today),
  };
}

export function serializeAudit(row) {
  if (!row) return null;
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json ?? "{}"); } catch {}
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actor: row.actor,
    timestamp: row.timestamp,
    metadata,
  };
}
