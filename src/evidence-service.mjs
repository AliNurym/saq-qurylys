import { randomUUID } from "node:crypto";
import { inTransaction } from "./db.mjs";
import { writeAudit } from "./audit-service.mjs";
import { decodeEvidenceImage } from "./image-evidence.mjs";

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
export function listEvidence(db, advertisementId) {
  return db.prepare("SELECT id,mime,sha256,captured_at AS capturedAt FROM evidence_files WHERE advertisement_id=? ORDER BY captured_at,id").all(advertisementId);
}
export function addEvidence(db, advertisementId, input) {
  const ad = db.prepare("SELECT id,complex_id FROM advertisements WHERE id=?").get(advertisementId);
  if (!ad) fail("Публикация не найдена.", 404);
  const {bytes,mime,sha256}=decodeEvidenceImage(input.data);
  const id = randomUUID();
  const capturedAt = new Date().toISOString();
  inTransaction(db, () => {
    db.prepare("INSERT INTO evidence_files VALUES (?,?,?,?,?,?)").run(id, advertisementId, mime, sha256, capturedAt, bytes);
    writeAudit(db, "ADVERTISEMENT", advertisementId, "EVIDENCE_CAPTURED", { complexId: ad.complex_id, evidenceId: id, sha256, capturedAt });
  });
  return { id, mime, sha256, capturedAt };
}
export function markSourceRemoved(db, advertisementId) {
  const ad = db.prepare("SELECT * FROM advertisements WHERE id=?").get(advertisementId);
  if (!ad) fail("Публикация не найдена.", 404);
  if (ad.source_status === "REMOVED") return { status: "REMOVED", removedAt: ad.source_removed_at };
  const now = new Date().toISOString();
  inTransaction(db, () => {
    db.prepare("UPDATE advertisements SET source_status='REMOVED',source_removed_at=? WHERE id=?").run(now, advertisementId);
    writeAudit(db, "ADVERTISEMENT", advertisementId, "SOURCE_REMOVAL_RECORDED", { complexId: ad.complex_id });
  });
  return { status: "REMOVED", removedAt: now };
}
