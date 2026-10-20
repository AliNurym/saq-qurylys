import { randomUUID } from "node:crypto";
import {objectConditionContext,getObjectConditions} from './object-conditions.mjs';
import { FACTORS, SCORING_VERSION, FACTOR_STATUS, LEGAL_BASIS, SIGNAL_STATUS } from "./constants.mjs";
import { inTransaction, createSchema } from "./db.mjs";
import { analyzeLocally } from "./ai-analyzer.mjs";
import { calculateRisk } from "./risk-engine.mjs";
import { serializeAdvertisement, serializeComplex } from "./serializers.mjs";

const stamped = "2026-10-14T09:00:00.000Z";
const analyst = "Demo Analyst";

export const DEMO_COMPLEXES = [
  { id: "cx-aspan", name: "Aspan Residence", city: "Алматы", address: "Алматы, ул. Демонстрационная, 17", latitude: 43.241, longitude: 76.927, developerName: "Aspan Development Demo LLP", developerBin: "000000000001", constructionStage: "Монолитные работы", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 62, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-08T09:00:00.000Z", verifiedCompletionPercentage: 55, verifiedCompletionSource: "Учебный осмотр площадки", verifiedCompletionCapturedAt: "2026-10-10T09:00:00.000Z", legalBasisType: null, legalBasisStatus: LEGAL_BASIS.UNKNOWN, legalBasisSource: "Демо-реестр: запись ещё не проверена", legalBasisCheckedAt: null },
  { id: "cx-orda", name: "Orda Park", city: "Астана", address: "Астана, ул. Учебная, 4", latitude: 51.162, longitude: 71.431, developerName: "Orda Construction Demo LLP", developerBin: "000000000002", constructionStage: "Подготовка к монтажу", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 48, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-08T09:00:00.000Z", verifiedCompletionPercentage: 41, verifiedCompletionSource: "Учебный осмотр площадки", verifiedCompletionCapturedAt: "2026-10-10T09:00:00.000Z", legalBasisType: "Проверка применимого основания", legalBasisStatus: LEGAL_BASIS.CONFIRMED_ABSENT, legalBasisSource: "Демонстрационная проверка документов", legalBasisCheckedAt: "2026-10-11T10:20:00.000Z" },
  { id: "cx-samal", name: "Samal City", city: "Алматы", address: "Алматы, ул. Примерная, 31", latitude: 43.267, longitude: 76.914, developerName: "Samal City Demo LLP", developerBin: "000000000003", constructionStage: "Отделочные работы", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 78, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-07T09:00:00.000Z", verifiedCompletionPercentage: 75, verifiedCompletionSource: "Учебный осмотр площадки", verifiedCompletionCapturedAt: "2026-10-10T09:00:00.000Z", legalBasisType: "Гарантия долевого строительства", legalBasisStatus: LEGAL_BASIS.CONFIRMED_VALID, legalBasisSource: "Демо-копия подтверждённой гарантии", legalBasisCheckedAt: "2026-10-11T10:20:00.000Z" },
  { id: "cx-qazyna", name: "Qazyna Towers", city: "Астана", address: "Астана, пр. Учебный, 22", latitude: 51.177, longitude: 71.462, developerName: "Qazyna Build Demo LLP", developerBin: "000000000004", constructionStage: "Каркас", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 85, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-03T09:00:00.000Z", verifiedCompletionPercentage: 55, verifiedCompletionSource: "Учебный отчёт технического специалиста", verifiedCompletionCapturedAt: "2026-10-11T09:00:00.000Z", legalBasisType: null, legalBasisStatus: LEGAL_BASIS.UNKNOWN, legalBasisSource: "Демо-реестр: требуется дополнительная проверка", legalBasisCheckedAt: null },
  { id: "cx-arman", name: "Arman Riverside", city: "Шымкент", address: "Шымкент, ул. Макетная, 8", latitude: 42.326, longitude: 69.585, developerName: "Arman Riverside Demo LLP", developerBin: "000000000005", constructionStage: "Фасадные работы", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 70, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-06T09:00:00.000Z", verifiedCompletionPercentage: 69, verifiedCompletionSource: "Учебный осмотр площадки", verifiedCompletionCapturedAt: "2026-10-10T09:00:00.000Z", legalBasisType: "Гарантия долевого строительства", legalBasisStatus: LEGAL_BASIS.CONFIRMED_VALID, legalBasisSource: "Демо-копия подтверждённой гарантии", legalBasisCheckedAt: "2026-10-11T10:20:00.000Z" },
  { id: "cx-nomad", name: "Nomad Garden", city: "Алматы", address: "Алматы, ул. Учебный сад, 6", latitude: 43.226, longitude: 76.988, developerName: "Nomad Garden Demo LLP", developerBin: "000000000006", constructionStage: "Кирпичная кладка", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 39, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-07T09:00:00.000Z", verifiedCompletionPercentage: 37, verifiedCompletionSource: "Учебный осмотр площадки", verifiedCompletionCapturedAt: "2026-10-10T09:00:00.000Z", legalBasisType: null, legalBasisStatus: LEGAL_BASIS.UNKNOWN, legalBasisSource: "Демо-реестр: статус не проверен", legalBasisCheckedAt: null },
  { id: "cx-tulpar", name: "Tulpar Avenue", city: "Астана", address: "Астана, ул. Демонстрационная, 29", latitude: 51.143, longitude: 71.486, developerName: "Tulpar Avenue Demo LLP", developerBin: "000000000007", constructionStage: "Фундаментные работы", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 27, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-08T09:00:00.000Z", verifiedCompletionPercentage: 25, verifiedCompletionSource: "Учебный осмотр площадки", verifiedCompletionCapturedAt: "2026-10-10T09:00:00.000Z", legalBasisType: null, legalBasisStatus: LEGAL_BASIS.UNDER_REVIEW, legalBasisSource: "Демонстрационные документы переданы на проверку", legalBasisCheckedAt: "2026-10-12T10:20:00.000Z" },
  { id: "cx-altai", name: "Altai Residence", city: "Шымкент", address: "Шымкент, ул. Схематичная, 12", latitude: 42.304, longitude: 69.612, developerName: "Altai Residence Demo LLP", developerBin: "000000000008", constructionStage: "Начальный этап", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 18, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-05T09:00:00.000Z", verifiedCompletionPercentage: 16, verifiedCompletionSource: "Учебный осмотр площадки", verifiedCompletionCapturedAt: "2026-10-10T09:00:00.000Z", legalBasisType: null, legalBasisStatus: LEGAL_BASIS.UNKNOWN, legalBasisSource: "Демо-реестр: запись ещё не проверена", legalBasisCheckedAt: null },
  { id: "cx-dala", name: "Dala Hills", city: "Алматы", address: "Алматы, ул. Учебная, 41", latitude: 43.253, longitude: 76.963, developerName: "Dala Hills Demo LLP", developerBin: "000000000009", constructionStage: "Монолитные работы", commissioningStatus: "UNDER_CONSTRUCTION", declaredCompletionPercentage: 52, declaredCompletionSource: "Демо-отчёт застройщика", declaredCompletionCapturedAt: "2026-10-08T09:00:00.000Z", verifiedCompletionPercentage: 48, verifiedCompletionSource: "Учебный осмотр площадки", verifiedCompletionCapturedAt: "2026-10-10T09:00:00.000Z", legalBasisType: "Проверка применимого основания", legalBasisStatus: LEGAL_BASIS.CONFIRMED_ABSENT, legalBasisSource: "Демонстрационная проверка документов", legalBasisCheckedAt: "2026-10-11T10:20:00.000Z" },
  { id: "cx-saryarka", name: "Saryarka City", city: "Астана", address: "Астана, ул. Схематичная, 3", latitude: 51.188, longitude: 71.418, developerName: "Saryarka City Demo LLP", developerBin: "000000000010", constructionStage: "Не подтверждён", commissioningStatus: "UNKNOWN", declaredCompletionPercentage: null, declaredCompletionSource: null, declaredCompletionCapturedAt: null, verifiedCompletionPercentage: null, verifiedCompletionSource: null, verifiedCompletionCapturedAt: null, legalBasisType: null, legalBasisStatus: LEGAL_BASIS.UNKNOWN, legalBasisSource: "Демо-реестр: нет проверенной записи", legalBasisCheckedAt: null },
];

export const DEMO_ADVERTISEMENTS = [
  { id: "ad-001", complexId: "cx-aspan", platform: "Instagram", account: "@aspan_demo", date: "2026-10-09", text: "Старт продаж в ЖК Aspan Residence. Для бронирования квартиры внесите депозит 500 000 ₸.", status: "MATCHED" },
  { id: "ad-002", complexId: "cx-aspan", platform: "Сайт проекта", account: "Aspan Demo", date: "2026-10-06", text: "В ЖК Aspan Residence открыта запись на экскурсию. Приходите посмотреть планировки.", status: "MATCHED" },
  { id: "ad-003", complexId: "cx-orda", platform: "Instagram", account: "@orda_park_demo", date: "2026-10-08", text: "Продажа квартир в ЖК Orda Park. Забронируйте квартиру: депозит 300 000 ₸.", status: "MATCHED" },
  { id: "ad-004", complexId: "cx-samal", platform: "Telegram", account: "@samal_city_demo", date: "2026-10-05", text: "ЖК Samal City: опубликованы новые планировки. Запишитесь на демонстрационный показ.", status: "MATCHED" },
  { id: "ad-005", complexId: "cx-qazyna", platform: "Сайт объявлений", account: "Qazyna Demo", date: "2026-10-07", text: "Старт продаж в ЖК Qazyna Towers. Внесите 400 000 ₸ для платной брони квартиры.", status: "MATCHED" },
  { id: "ad-006", complexId: "cx-qazyna", platform: "Instagram", account: "@qazyna_towers_demo", date: "2026-10-02", text: "ЖК Qazyna Towers приглашает на просмотр макета и консультацию по планировкам.", status: "MATCHED" },
  { id: "ad-007", complexId: "cx-arman", platform: "Telegram", account: "@arman_riverside_demo", date: "2026-10-04", text: "Продажа квартир в Arman Riverside. Идут фасадные работы, запись на просмотр по телефону.", status: "MATCHED" },
  { id: "ad-008", complexId: "cx-nomad", platform: "Instagram", account: "@nomad_garden_demo", date: "2026-10-03", text: "Продажа квартир в ЖК Nomad Garden. Посмотрите ход строительства и выберите планировку.", status: "MATCHED" },
  { id: "ad-009", complexId: "cx-tulpar", platform: "Сайт проекта", account: "Tulpar Demo", date: "2026-10-01", text: "В ЖК Tulpar Avenue можно забронировать квартиру. Первоначальный взнос от 20%.", status: "MATCHED" },
  { id: "ad-010", complexId: "cx-altai", platform: "Telegram", account: "@altai_residence_demo", date: "2026-10-13", text: "Открываем шоурум Altai Residence. Приходите посмотреть планировки, бронь без депозита.", status: "MATCHED" },
  { id: "ad-011", complexId: null, proposedComplexId: "cx-aspan", platform: "Instagram", account: "@qurylys_demo_11", date: "2026-10-14", text: "ЖК Aspan Residence: для фиксации квартиры внесите депозит 250 000 ₸.", status: "MATCH_PENDING" },
  { id: "ad-012", complexId: null, proposedComplexId: "cx-tulpar", platform: "Telegram", account: "@qurylys_demo_12", date: "2026-10-13", text: "В ЖК Tulpar Avenue старт продаж. Для бронирования внесите 200 000 ₸.", status: "MATCH_PENDING" },
  { id: "ad-013", complexId: null, proposedComplexId: null, platform: "Сайт объявлений", account: "Demo Homes 13", date: "2026-10-12", text: "Планировки в новом жилом комплексе. Запись на консультацию открыта.", status: "NEW" },
  { id: "ad-014", complexId: null, proposedComplexId: null, platform: "Instagram", account: "@qurylys_demo_14", date: "2026-10-11", text: "Открыта экскурсия по строящемуся дому. Оплата за консультацию не требуется.", status: "NEW" },
  { id: "ad-015", complexId: "cx-dala", platform: "Telegram", account: "@qurylys_demo_15", date: "2026-10-10", text: "Продажа квартир в Dala Hills. Забронируйте квартиру, депозит 350 000 ₸.", status: "MATCHED" },
  { id: "ad-016", complexId: null, proposedComplexId: null, platform: "Сайт объявлений", account: "Demo Homes 16", date: "2026-10-14", text: "Семейный жилой комплекс рядом с парком. Узнайте о доступных планировках.", status: "NEW" },
];

const confirmed = FACTOR_STATUS.CONFIRMED;
const hypothesis = FACTOR_STATUS.AI_HYPOTHESIS;
const rejected = FACTOR_STATUS.REJECTED;

const DEMO_FACTORS = [
  { id: "rf-aspan-r2", complexId: "cx-aspan", code: "R2", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-001", sourceLabel: "Публикация AD-001 · Instagram", evidenceText: "Для бронирования квартиры внесите депозит 500 000 ₸.", confidence: 0.91, confirmedBy: analyst, confirmedAt: "2026-10-09T14:15:00.000Z", notes: "Фрагмент проверен аналитиком." },
  { id: "rf-aspan-r3", complexId: "cx-aspan", code: "R3", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-001", sourceLabel: "Публикация AD-001 · Instagram", evidenceText: "Старт продаж в ЖК Aspan Residence.", confidence: 0.78, confirmedBy: analyst, confirmedAt: "2026-10-09T14:16:00.000Z", notes: "Объект строится; статус объявления подтверждён." },
  { id: "rf-orda-r1", complexId: "cx-orda", code: "R1", status: confirmed, sourceType: "MANUAL_REVIEW", sourceId: "legal-orda", sourceLabel: "Демонстрационная проверка документов", evidenceText: "Учебное заключение подтверждает отсутствие применимого правового основания после проверки всех предусмотренных способов его получения.", confidence: 1, confirmedBy: analyst, confirmedAt: "2026-10-11T10:22:00.000Z", notes: "Демо-вывод по вымышленному объекту; отсутствующие сведения сами по себе не являются основанием." },
  { id: "rf-orda-r2", complexId: "cx-orda", code: "R2", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-003", sourceLabel: "Публикация AD-003 · Instagram", evidenceText: "Забронируйте квартиру: депозит 300 000 ₸.", confidence: 0.91, confirmedBy: analyst, confirmedAt: "2026-10-08T11:05:00.000Z", notes: "Фрагмент проверен аналитиком." },
  { id: "rf-orda-r3", complexId: "cx-orda", code: "R3", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-003", sourceLabel: "Публикация AD-003 · Instagram", evidenceText: "Продажа квартир в ЖК Orda Park.", confidence: 0.78, confirmedBy: analyst, confirmedAt: "2026-10-08T11:06:00.000Z", notes: "Объект строится; статус объявления подтверждён." },
  { id: "rf-samal-r3", complexId: "cx-samal", code: "R3", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-004", sourceLabel: "Публикация AD-004 · Telegram", evidenceText: "ЖК Samal City: опубликованы новые планировки.", confidence: 0.76, confirmedBy: analyst, confirmedAt: "2026-10-05T12:00:00.000Z", notes: "Обычная реклама без предложения платежа." },
  { id: "rf-qazyna-r2", complexId: "cx-qazyna", code: "R2", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-005", sourceLabel: "Публикация AD-005 · сайт объявлений", evidenceText: "Внесите 400 000 ₸ для платной брони квартиры.", confidence: 0.94, confirmedBy: analyst, confirmedAt: "2026-10-07T12:00:00.000Z", notes: "Фрагмент проверен аналитиком." },
  { id: "rf-qazyna-r3", complexId: "cx-qazyna", code: "R3", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-005", sourceLabel: "Публикация AD-005 · сайт объявлений", evidenceText: "Старт продаж в ЖК Qazyna Towers.", confidence: 0.78, confirmedBy: analyst, confirmedAt: "2026-10-07T12:02:00.000Z", notes: "Объект строится; статус объявления подтверждён." },
  { id: "rf-qazyna-r5", complexId: "cx-qazyna", code: "R5", status: confirmed, sourceType: "CONSTRUCTION_REPORT", sourceId: "progress-qazyna", sourceLabel: "Демо-отчёт застройщика и учебный осмотр", evidenceText: "Заявлено 85% (демо-отчёт от 03.10.2026); подтверждено 55% (учебный осмотр от 11.10.2026); разница 30 п.п.", confidence: 1, confirmedBy: analyst, confirmedAt: "2026-10-11T14:00:00.000Z", notes: "Оба значения имеют источник и дату фиксации." },
  { id: "rf-qazyna-r6-ai", complexId: "cx-qazyna", code: "R6", status: hypothesis, sourceType: "AI_EXTRACTION", sourceId: "analysis-ad-006", sourceLabel: "Гипотеза AI по публикации AD-006", evidenceText: "Идут работы на площадке; требуется проверить график.", confidence: 0.63, notes: "Не подтверждено: одной публикации недостаточно для вывода о простое." },
  { id: "rf-arman-r3", complexId: "cx-arman", code: "R3", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-007", sourceLabel: "Публикация AD-007 · Telegram", evidenceText: "Продажа квартир в Arman Riverside.", confidence: 0.77, confirmedBy: analyst, confirmedAt: "2026-10-04T12:00:00.000Z", notes: "Объект строится; статус объявления подтверждён." },
  { id: "rf-arman-r6", complexId: "cx-arman", code: "R6", status: confirmed, sourceType: "CONSTRUCTION_REPORT", sourceId: "delay-arman", sourceLabel: "Учебный журнал строительного контроля", evidenceText: "Зафиксирован документированный простой на учебной площадке; запись от 02.10.2026.", confidence: 1, confirmedBy: analyst, confirmedAt: "2026-10-10T09:10:00.000Z", notes: "Демо-событие подтверждено учебным источником." },
  { id: "rf-nomad-r3", complexId: "cx-nomad", code: "R3", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-008", sourceLabel: "Публикация AD-008 · Instagram", evidenceText: "Продажа квартир в ЖК Nomad Garden.", confidence: 0.77, confirmedBy: analyst, confirmedAt: "2026-10-03T12:00:00.000Z", notes: "Объект строится; статус объявления подтверждён." },
  { id: "rf-nomad-r4", complexId: "cx-nomad", code: "R4", status: confirmed, sourceType: "COMPLAINT", sourceId: "complaint-nomad", sourceLabel: "Проверенное демонстрационное обращение", evidenceText: "Подтверждено коллективное обращение в учебном наборе данных.", confidence: 1, confirmedBy: analyst, confirmedAt: "2026-10-03T13:00:00.000Z", notes: "Обращение вымышленное и используется только как demo." },
  { id: "rf-tulpar-r2", complexId: "cx-tulpar", code: "R2", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-009", sourceLabel: "Публикация AD-009 · сайт проекта", evidenceText: "Первоначальный взнос от 20%.", confidence: 0.82, confirmedBy: analyst, confirmedAt: "2026-10-01T12:00:00.000Z", notes: "Фрагмент проверен аналитиком." },
  { id: "rf-tulpar-r3", complexId: "cx-tulpar", code: "R3", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-009", sourceLabel: "Публикация AD-009 · сайт проекта", evidenceText: "В ЖК Tulpar Avenue можно забронировать квартиру.", confidence: 0.77, confirmedBy: analyst, confirmedAt: "2026-10-01T12:02:00.000Z", notes: "Объект строится; статус объявления подтверждён." },
  { id: "rf-tulpar-r4-ai", complexId: "cx-tulpar", code: "R4", status: hypothesis, sourceType: "AI_EXTRACTION", sourceId: "manual-triage-tulpar", sourceLabel: "Гипотеза AI: требуется поиск обращения", evidenceText: "В тексте объявления обращение граждан не упоминается.", confidence: 0.34, notes: "Слабая гипотеза; баллы не начислены." },
  { id: "rf-dala-r1", complexId: "cx-dala", code: "R1", status: confirmed, sourceType: "MANUAL_REVIEW", sourceId: "legal-dala", sourceLabel: "Демонстрационная проверка документов", evidenceText: "Учебное заключение подтверждает отсутствие применимого правового основания после проверки всех предусмотренных способов его получения.", confidence: 1, confirmedBy: analyst, confirmedAt: "2026-10-11T10:30:00.000Z", notes: "Демо-вывод по вымышленному объекту." },
  { id: "rf-dala-r2", complexId: "cx-dala", code: "R2", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-015", sourceLabel: "Публикация AD-015 · Telegram", evidenceText: "депозит 350 000 ₸", confidence: 0.91, confirmedBy: analyst, confirmedAt: "2026-10-12T10:30:00.000Z", notes: "Фрагмент проверен аналитиком." },
  { id: "rf-dala-r3", complexId: "cx-dala", code: "R3", status: confirmed, sourceType: "ADVERTISEMENT", sourceId: "ad-015", sourceLabel: "Публикация AD-015 · Telegram", evidenceText: "Продажа квартир в Dala Hills.", confidence: 0.78, confirmedBy: analyst, confirmedAt: "2026-10-12T10:31:00.000Z", notes: "Объект строится; статус объявления подтверждён." },
  { id: "rf-dala-r4", complexId: "cx-dala", code: "R4", status: confirmed, sourceType: "COMPLAINT", sourceId: "complaint-dala", sourceLabel: "Проверенное демонстрационное обращение", evidenceText: "В демо-наборе проверено коллективное обращение по объекту.", confidence: 1, confirmedBy: analyst, confirmedAt: "2026-10-12T10:35:00.000Z", notes: "Обращение полностью вымышленное." },
  { id: "rf-saryarka-r3-ai", complexId: "cx-saryarka", code: "R3", status: hypothesis, sourceType: "AI_EXTRACTION", sourceId: "analysis-saryarka", sourceLabel: "Гипотеза AI: требуется проверить публикацию", evidenceText: "Жилой комплекс, публикация требует сопоставления.", confidence: 0.52, notes: "Объект и стадия не подтверждены." },
];

export function clearDatabase(db) {
  if (db.prepare("SELECT mode FROM dataset_config WHERE id=1").get().mode === "working") {
    throw new Error("Сброс запрещён для рабочей базы.");
  }
  if (["collection_sources", "background_jobs"].some(table => db.prepare("SELECT 1 FROM " + table + " LIMIT 1").get())) {
    throw new Error("База со сбором источников не сбрасывается: сохраните архив и используйте отдельную пустую базу для демонстрации.");
  }
  if(db.prepare('SELECT 1 FROM construction_observations LIMIT 1').get())throw new Error('База с фотофиксацией не сбрасывается: сохраните доказательства и используйте отдельную пустую базу.');
  if(db.prepare('SELECT 1 FROM readiness_history LIMIT 1').get())throw new Error('База с историей готовности не сбрасывается: используйте отдельную пустую базу.');
  if(db.prepare('SELECT 1 FROM complaint_intakes LIMIT 1').get())throw new Error('База с зарегистрированными обращениями не сбрасывается: сохраните материалы и используйте отдельную пустую базу.');
  db.exec([
    "DROP TABLE IF EXISTS complaint_reviews;",
    "DROP TABLE IF EXISTS complaint_intakes;",
    "DROP TABLE IF EXISTS object_condition_reviews;",
    "DROP TABLE IF EXISTS red_monitoring_state;",
    "DROP TABLE IF EXISTS evidence_files;",
    "DROP TABLE IF EXISTS monitoring_runs;",
    "DROP TABLE IF EXISTS risk_history;",
    "DROP TABLE IF EXISTS audit_logs;",
    "DROP TABLE IF EXISTS signals;",
    "DROP TABLE IF EXISTS risk_factors;",
    "DROP TABLE IF EXISTS construction_events;",
    "DROP TABLE IF EXISTS complaints;",
    "DROP TABLE IF EXISTS ai_analyses;",
    "DROP TABLE IF EXISTS advertisements;",
    "DROP TABLE IF EXISTS complex_contacts;",
    "DROP TABLE IF EXISTS complexes;",
  ].join("\n"));
  createSchema(db);
}
function insertFactor(db, factor) {
  db.prepare(
    "INSERT INTO risk_factors (id, complex_id, code, weight, status, source_type, source_id, source_label, evidence_text, confidence, confirmed_by, confirmed_at, rejected_by, rejected_at, notes, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
  ).run(
    factor.id, factor.complexId, factor.code, FACTORS[factor.code].weight, factor.status,
    factor.sourceType, factor.sourceId, factor.sourceLabel ?? null, factor.evidenceText ?? null,
    factor.confidence ?? null, factor.confirmedBy ?? null, factor.confirmedAt ?? null,
    factor.rejectedBy ?? null, factor.rejectedAt ?? null, factor.notes ?? null, stamped,
  );
}

function recordAudit(db, entityType, entityId, action, metadata = {}) {
  db.prepare(
    "INSERT INTO audit_logs (id, entity_type, entity_id, action, actor, timestamp, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), entityType, entityId, action, analyst, stamped, JSON.stringify(metadata));
}

function factorRowsFor(db, complexId) {
  return db.prepare("SELECT * FROM risk_factors WHERE complex_id = ?").all(complexId);
}

import { PILOT48_COMPLEXES, PILOT48_ADVERTISEMENTS, getPilot48Factors } from "./pilot48-data.mjs";

export function seedDemoData(db, { reset = false, pilot48 = false } = {}) {
  if (process.env.SAQ_DATA_MODE === "working" || db.prepare("SELECT mode FROM dataset_config WHERE id=1").get().mode === "working") {
    throw new Error("Учебные данные и сброс запрещены для рабочей базы.");
  }
  if (reset) clearDatabase(db);
  const existing = db.prepare("SELECT COUNT(*) AS count FROM complexes").get().count;
  if (existing > 0) return { seeded: false, complexes: existing };

  const isPilot48 = pilot48 || process.env.SAQ_PILOT_48 === "1";

  if (isPilot48) {
    return seedPilot48(db);
  }

  inTransaction(db, () => {
    const insertComplex = db.prepare(
      "INSERT INTO complexes (id,name,city,address,latitude,longitude,developer_name,developer_bin,construction_stage,commissioning_status,declared_completion_pct,declared_completion_source,declared_completion_at,verified_completion_pct,verified_completion_source,verified_completion_at,legal_basis_type,legal_basis_status,legal_basis_source,legal_basis_checked_at,created_at,updated_at,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
    );
    for (const complex of DEMO_COMPLEXES) {
      insertComplex.run(
        complex.id, complex.name, complex.city, complex.address, complex.latitude, complex.longitude,
        complex.developerName, complex.developerBin, complex.constructionStage, complex.commissioningStatus,
        complex.declaredCompletionPercentage, complex.declaredCompletionSource, complex.declaredCompletionCapturedAt,
        complex.verifiedCompletionPercentage, complex.verifiedCompletionSource, complex.verifiedCompletionCapturedAt,
        complex.legalBasisType, complex.legalBasisStatus, complex.legalBasisSource, complex.legalBasisCheckedAt,
        stamped, stamped,
      );
    }

    for (const [index, complex] of DEMO_COMPLEXES.entries()) db.prepare("UPDATE complexes SET object_number=? WHERE id=?").run("SQ-OBJ-" + String(index + 1).padStart(4, "0"), complex.id);

    const contacts = [
      ["contact-a-account", "cx-aspan", "ACCOUNT", "@aspan_demo", "Демо-реквизит"],
      ["contact-orda-account", "cx-orda", "ACCOUNT", "@orda_park_demo", "Демо-реквизит"],
      ["contact-nomad-account", "cx-nomad", "ACCOUNT", "@nomad_garden_demo", "Демо-реквизит"],
    ];
    const insertContact = db.prepare("INSERT INTO complex_contacts (id,complex_id,type,value,source_label,is_demo) VALUES (?,?,?,?,?,1)");
    for (const contact of contacts) insertContact.run(...contact);

    const insertAd = db.prepare(
      "INSERT INTO advertisements (id,platform,account,phone,publication_date,url,text,screenshot_path,captured_at,complex_id,suggested_complex_id,link_status,is_demo,created_at) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)",
    );
    const insertAnalysis = db.prepare(
      "INSERT INTO ai_analyses (id,advertisement_id,model,created_at,status,summary,detected_complex_name,detected_address,detected_developer,detected_phone,payment_detected,payment_type,amount,currency,confidence,evidence_text,analysis_source,analysis_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const ad of DEMO_ADVERTISEMENTS) {
      const url = "https://demo.invalid/publication/" + ad.id;
      const capturedAt = ad.date + "T10:00:00.000Z";
      insertAd.run(ad.id, ad.platform, ad.account, ad.phone ?? null, ad.date, url, ad.text, capturedAt, ad.complexId, ad.proposedComplexId ?? null, ad.status, 1, capturedAt);
      const analysis = analyzeLocally({ text: ad.text, complexes: DEMO_COMPLEXES });
      insertAnalysis.run(
        "analysis-" + ad.id, ad.id, null, capturedAt, "COMPLETED", analysis.summary,
        analysis.residentialComplex.name, analysis.address.value, analysis.developer.name,
        analysis.phoneNumbers[0] ?? ad.phone ?? null, analysis.paymentOffer.detected ? 1 : 0,
        analysis.paymentOffer.type, analysis.paymentOffer.amount, analysis.paymentOffer.currency,
        analysis.paymentOffer.confidence, analysis.paymentOffer.evidence,
        analysis.analysisSource, JSON.stringify(analysis),
      );
    }

    for (const factor of DEMO_FACTORS) insertFactor(db, factor);

    const complaints = [
      ["complaint-nomad", "cx-nomad", "COLLECTIVE", 1, "Подтверждённое демонстрационное обращение.", "Учебная карточка обращения", "2026-10-03T12:30:00.000Z"],
      ["complaint-dala", "cx-dala", "COLLECTIVE", 1, "Подтверждённое демонстрационное обращение.", "Учебная карточка обращения", "2026-10-12T10:32:00.000Z"],
    ];
    const insertComplaint = db.prepare("INSERT INTO complaints (id,complex_id,type,verified,summary,source,captured_at) VALUES (?,?,?,?,?,?,?)");
    for (const item of complaints) insertComplaint.run(...item);

    const events = [
      ["event-qazyna-progress", "cx-qazyna", "PROGRESS_CHECK", "2026-10-11", "Учебный осмотр зафиксировал 55% готовности.", "Учебный отчёт технического специалиста", 1],
      ["event-arman-delay", "cx-arman", "DOCUMENTED_DELAY", "2026-10-02", "Демо-журнал отмечает период простоя на учебной площадке.", "Учебный журнал строительного контроля", 1],
    ];
    const insertEvent = db.prepare("INSERT INTO construction_events (id,complex_id,type,event_date,description,source,confirmed) VALUES (?,?,?,?,?,?,?)");
    for (const item of events) insertEvent.run(...item);

    for (const complex of DEMO_COMPLEXES) {
      const risk = calculateRisk(factorRowsFor(db, complex.id), complex.legalBasisStatus);
      db.prepare(
        "INSERT INTO risk_history (complex_id,score,zone,reason,actor,created_at) VALUES (?,?,?,?,?,?)",
      ).run(complex.id, risk.score, risk.zone, "Начальный снимок подтверждённых demo-факторов", analyst, stamped);
    }

    for(const complex of DEMO_COMPLEXES.filter(item=>item.legalBasisStatus==='CONFIRMED_VALID')) {
      const concern=factorRowsFor(db,complex.id).some(factor=>factor.status==='CONFIRMED'&&['R2','R4','R5','R6','DELAY'].includes(factor.code));
      if(concern)continue;
      const context=objectConditionContext(db,complex.id);
      db.prepare('INSERT INTO object_condition_reviews (id,complex_id,checked_date,created_at,created_by,source,evidence_text,checks_json,context_sha256,context_json,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),complex.id,stamped.slice(0,10),stamped,analyst,'Учебная фикстура проверки условий; не государственный реестр','Демонстрационный сценарий: документы относятся к учебному объекту, стройка ведётся, существенных жалоб и просрочек нет.',JSON.stringify({documentsMatch:true,constructionActive:true,complaintsClear:true,delaysClear:true}),context.sha256,context.json,1);
    }
    const signalSpecs = [
      { id: "SIG-20261014-001", complexId: "cx-orda", status: SIGNAL_STATUS.CONFIRMED, createdAt: "2026-10-11T11:00:00.000Z", reviewedAt: "2026-10-11T13:00:00.000Z", comment: "Подтверждено для последующей проверки специалистом." },
      { id: "SIG-20261014-002", complexId: "cx-aspan", status: SIGNAL_STATUS.NEEDS_REVIEW, createdAt: "2026-10-12T11:00:00.000Z", reviewedAt: null, comment: "Требуется проверить правовое основание; неизвестность не трактуется как отсутствие." },
      { id: "SIG-20261014-003", complexId: "cx-nomad", status: SIGNAL_STATUS.RETURNED, createdAt: "2026-10-13T11:00:00.000Z", reviewedAt: "2026-10-13T12:00:00.000Z", comment: "Вернуть на уточнение источника коллективного обращения." },
    ];
    const insertSignal = db.prepare(
      "INSERT INTO signals (id,complex_id,score_snapshot,zone_snapshot,legal_basis_snapshot,factor_snapshot_json,context_snapshot_json,status,created_by,created_at,reviewed_by,reviewed_at,comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const spec of signalSpecs) {
      const complex = DEMO_COMPLEXES.find((item) => item.id === spec.complexId);
      const factors = factorRowsFor(db, spec.complexId);
      const risk = calculateRisk(factors, complex.legalBasisStatus,null,getObjectConditions(db,complex.id));
      const snapshot = factors.map((item) => ({
        id: item.id, code: item.code, status: item.status, weight: item.weight,
        evidenceText: item.evidence_text, sourceType: item.source_type, sourceId: item.source_id,
        sourceLabel: item.source_label, confirmedBy: item.confirmed_by, confirmedAt: item.confirmed_at,
      }));
      insertSignal.run(
        spec.id, spec.complexId, risk.score, risk.zone, complex.legalBasisStatus, JSON.stringify(snapshot),
        JSON.stringify({ version: 1, scoringVersion: SCORING_VERSION, complex: serializeComplex(db.prepare("SELECT * FROM complexes WHERE id = ?").get(spec.complexId)), advertisements: db.prepare("SELECT * FROM advertisements WHERE complex_id = ?").all(spec.complexId).map(serializeAdvertisement) }),
        spec.status, analyst, spec.createdAt, spec.reviewedAt ? analyst : null, spec.reviewedAt, spec.comment,
      );
      recordAudit(db, "SIGNAL", spec.id, "SIGNAL_SEEDED", { status: spec.status, score: risk.score });
    }

    recordAudit(db, "SYSTEM", "demo-seed", "DEMO_DATA_SEEDED", { complexes: DEMO_COMPLEXES.length, advertisements: DEMO_ADVERTISEMENTS.length });
  });

  return { seeded: true, complexes: DEMO_COMPLEXES.length, advertisements: DEMO_ADVERTISEMENTS.length };
}

function seedPilot48(db) {
  const pilotDemoActor = "Демо-сценарий (не сотрудник МИО)";
  const demoSource = (value) => value ? "Демо-сценарий; реальный источник не предоставлен" : null;
  const demoUnverified = "Не предоставлено в демо; требуется первичный источник.";
  inTransaction(db, () => {
    const insertComplex = db.prepare(
      "INSERT INTO complexes (id,object_number,name,city,address,latitude,longitude,developer_name,developer_bin,construction_stage,commissioning_status,declared_completion_pct,declared_completion_source,declared_completion_at,verified_completion_pct,verified_completion_source,verified_completion_at,legal_basis_type,legal_basis_status,legal_basis_source,legal_basis_checked_at,passport_json,created_at,updated_at,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
    );

    for (const complex of PILOT48_COMPLEXES) {
      const passportObj = {
        // Never present generated people or bank-account data as plausible facts,
        // even inside an explicitly synthetic pilot fixture.
        fields: { ...(complex.passport || {}), director: demoUnverified, founders: demoUnverified, bankDetails: demoUnverified },
        source: "Синтетическая демонстрационная фикстура; официальный реестр не подключён",
        checkedAt: null,
        verificationMode: "DEMO_SCENARIO"
      };
      insertComplex.run(
        complex.id, complex.objectNumber, complex.name, complex.city, complex.address, complex.latitude, complex.longitude,
        complex.developerName, complex.developerBin, complex.constructionStage, complex.commissioningStatus,
        complex.declaredCompletionPercentage, demoSource(complex.declaredCompletionSource), complex.declaredCompletionCapturedAt,
        complex.verifiedCompletionPercentage, demoSource(complex.verifiedCompletionSource), complex.verifiedCompletionCapturedAt,
        complex.legalBasisType, complex.legalBasisStatus, demoSource(complex.legalBasisSource), complex.legalBasisCheckedAt,
        JSON.stringify(passportObj), stamped, stamped,
      );
    }

    // Contacts
    const insertContact = db.prepare("INSERT INTO complex_contacts (id,complex_id,type,value,source_label,is_demo) VALUES (?,?,?,?,?,1)");
    for (const complex of PILOT48_COMPLEXES.slice(0, 10)) {
      if (complex.passport?.websites) {
        insertContact.run("contact-" + complex.id + "-web", complex.id, "ACCOUNT", "Демо-сценарий · " + complex.passport.websites.split(",")[0].trim(), "Демо-сценарий · сайт");
      }
    }

    // Advertisements
    const insertAd = db.prepare(
      "INSERT INTO advertisements (id,platform,account,phone,publication_date,url,text,screenshot_path,captured_at,complex_id,suggested_complex_id,link_status,is_demo,created_at) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)",
    );
    const insertAnalysis = db.prepare(
      "INSERT INTO ai_analyses (id,advertisement_id,model,created_at,status,summary,detected_complex_name,detected_address,detected_developer,detected_phone,payment_detected,payment_type,amount,currency,confidence,evidence_text,analysis_source,analysis_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );

    for (const ad of PILOT48_ADVERTISEMENTS) {
      const url = "https://demo.invalid/oskemen/pub/" + ad.id;
      const capturedAt = ad.date + "T10:00:00.000Z";
      insertAd.run(ad.id, ad.platform, ad.account, ad.phone ?? null, ad.date, url, ad.text, capturedAt, ad.complexId, ad.proposedComplexId ?? null, ad.status, 1, capturedAt);
      const analysis = analyzeLocally({ text: ad.text, complexes: PILOT48_COMPLEXES });
      insertAnalysis.run(
        "analysis-" + ad.id, ad.id, null, capturedAt, "COMPLETED", analysis.summary,
        analysis.residentialComplex.name, analysis.address.value, analysis.developer.name,
        analysis.phoneNumbers[0] ?? ad.phone ?? null, analysis.paymentOffer.detected ? 1 : 0,
        analysis.paymentOffer.type, analysis.paymentOffer.amount, analysis.paymentOffer.currency,
        analysis.paymentOffer.confidence, analysis.paymentOffer.evidence,
        analysis.analysisSource, JSON.stringify(analysis),
      );
    }

    // Factors
    const factors = getPilot48Factors();
    for (const factor of factors) insertFactor(db, {
      ...factor,
      sourceLabel: factor.sourceLabel ? "Демо-сценарий · " + factor.sourceLabel : "Демо-сценарий",
      evidenceText: factor.evidenceText ? "Демо-сценарий; текст синтетический, не первичный документ: " + factor.evidenceText : null,
      confirmedBy: factor.status === FACTOR_STATUS.CONFIRMED ? pilotDemoActor : factor.confirmedBy,
      notes: "Синтетический сценарий для проверки интерфейса и правил; это не реальная проверка или доказательство.",
    });

    // Initial risk history for all 48 complexes
    for (const complex of PILOT48_COMPLEXES) {
      const fRows = factorRowsFor(db, complex.id);
      const risk = calculateRisk(fRows, complex.legalBasisStatus);
      db.prepare(
        "INSERT INTO risk_history (complex_id,score,zone,reason,actor,created_at) VALUES (?,?,?,?,?,?)",
      ).run(complex.id, risk.score, risk.zone, "Демо-сценарий: начальная оценка синтетической записи", pilotDemoActor, stamped);
    }

    // Set object conditions for GREEN zone complexes (31 complexes)
    for (const complex of PILOT48_COMPLEXES.filter(item => item.scenarioGroup === "green")) {
      const context = objectConditionContext(db, complex.id);
      db.prepare(
        "INSERT INTO object_condition_reviews (id,complex_id,checked_date,created_at,created_by,source,evidence_text,checks_json,context_sha256,context_json,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(), complex.id, stamped.slice(0, 10), stamped, pilotDemoActor,
        "Демо-сценарий; не проверка МИО",
        "Синтетический сценарий для демонстрации зелёной зоны. Документы и проверки вымышлены; официальные источники не подключены.",
        JSON.stringify({ documentsMatch: true, constructionActive: true, complaintsClear: true, delaysClear: true }),
        context.sha256, context.json, 1,
      );
    }

    // Automatically create signal cards for all 5 RED zone complexes (Section 4.5 & 7 of ТЗ)
    const redComplexes = PILOT48_COMPLEXES.filter(item => item.scenarioGroup === "red");
    const insertSignal = db.prepare(
      "INSERT INTO signals (id,complex_id,score_snapshot,zone_snapshot,legal_basis_snapshot,factor_snapshot_json,context_snapshot_json,routing_json,status,created_by,created_at,reviewed_by,reviewed_at,comment) VALUES (?,?,?,?,?,?,?,?,?,'Система SAQ QURYLYS',?,?,?,?)",
    );

    let signalSeq = 1;
    for (const red of redComplexes) {
      const sigId = "SQ-2026-" + String(signalSeq++).padStart(4, "0");
      const fRows = factorRowsFor(db, red.id);
      const risk = calculateRisk(fRows, red.legalBasisStatus, null, getObjectConditions(db, red.id));
      const factorSnapshot = fRows.map(row => ({
        id: row.id, code: row.code, label: FACTORS[row.code]?.label ?? row.code,
        status: row.status, weight: row.weight, evidenceText: row.evidence_text,
        sourceType: row.source_type, sourceId: row.source_id, sourceLabel: row.source_label,
        confirmedBy: row.confirmed_by, confirmedAt: row.confirmed_at,
      }));
      const contextSnapshot = {
        version: 2,
        scoringVersion: risk.scoringVersion,
        zonePolicyVersion: risk.zonePolicyVersion,
        complex: serializeComplex(db.prepare("SELECT * FROM complexes WHERE id=?").get(red.id)),
        advertisements: db.prepare("SELECT * FROM advertisements WHERE complex_id=?").all(red.id).map(serializeAdvertisement),
        proposedActions: [
          "Запросить документы у застройщика",
          "Провести осмотр строительной площадки инспекцией ГАСК",
          "Опросить обратившихся граждан",
          "Запросить сведения о банковских поступлениях и счетах"
        ],
        legalNotice: "Красная зона означает приоритет проверки и не устанавливает виновность. ИИ не принимает правовых решений."
      };

      // Synthetic cards only demonstrate that an MIO decision is required.
      const routing = {};
      const comment = "Демо-сценарий: карточка создана для демонстрации красной зоны и требует проверки сотрудником МИО. Данные синтетические; назначение получателю и результат отсутствуют.";

      insertSignal.run(
        sigId, red.id, risk.score, risk.zone, red.legalBasisStatus,
        JSON.stringify(factorSnapshot), JSON.stringify(contextSnapshot),
        JSON.stringify(routing), SIGNAL_STATUS.NEEDS_REVIEW, stamped, null, null, comment
      );

      recordAudit(db, "SIGNAL", sigId, "SIGNAL_CREATED", {
        complexId: red.id, complexName: red.name, score: risk.score, zone: risk.zone, automatic: true
      });
    }

    recordAudit(db, "SYSTEM", "pilot-seed", "PILOT_48_SEEDED", {
      complexes: PILOT48_COMPLEXES.length,
      green: PILOT48_COMPLEXES.filter(c => c.scenarioGroup === "green").length,
      yellow: PILOT48_COMPLEXES.filter(c => c.scenarioGroup === "yellow").length,
      red: PILOT48_COMPLEXES.filter(c => c.scenarioGroup === "red").length,
      city: "Усть-Каменогорск"
    });
  });

  return {
    seeded: true,
    complexes: PILOT48_COMPLEXES.length,
    advertisements: PILOT48_ADVERTISEMENTS.length,
    city: "Усть-Каменогорск"
  };
}
