import test from "node:test";
import assert from "node:assert/strict";
import { calculateRisk, displayRiskCategory } from "../src/risk-engine.mjs";
const factors = (...codes) => codes.map(code => ({code,status:"CONFIRMED"}));

test("case B: confirmed absence, payment and advertising give 70 red", () => {
 const risk=calculateRisk(factors("R1","R2","R3"),"CONFIRMED_ABSENT");
 assert.equal(risk.score,70); assert.equal(risk.zone,"red"); assert.equal(risk.redRuleSatisfied,true);
});
test("unknown and under-review legal basis do not score R1 and remain reviewable", () => {
 for(const status of ["UNKNOWN","UNDER_REVIEW"]) {
  const risk=calculateRisk(factors("R1"),status); assert.equal(risk.score,0); assert.equal(displayRiskCategory(risk),"green"); assert.equal(risk.needsReview,true);
 }
 const unknown=calculateRisk(factors("R1","R2","R3"),"UNKNOWN");
 assert.equal(unknown.score,35); assert.equal(unknown.zone,"yellow"); assert.equal(unknown.redRuleSatisfied,false);
});
test("case C: ordinary active-construction advertising gives 10 green", () => {
 const risk=calculateRisk(factors("R3"),"CONFIRMED_VALID",null,{eligible:true}); assert.equal(risk.score,10); assert.equal(risk.zone,"green");
});
test("score 60 stays yellow unless both R1 and R2 are confirmed", () => {
 const risk=calculateRisk(factors("R1","R2"),"CONFIRMED_ABSENT"); assert.equal(risk.score,60); assert.equal(risk.zone,"red");
 const withoutR1=calculateRisk(factors("R2","R3","R4","R5"),"UNKNOWN"); assert.equal(withoutR1.score,60); assert.equal(withoutR1.zone,"yellow");
});
test("confirmed delay scores 5 and collective complaint scores 15", () => {
 assert.equal(calculateRisk(factors("R6"),"CONFIRMED_VALID").score,5);
 assert.equal(calculateRisk(factors("R4"),"CONFIRMED_VALID").score,15);
});
test("red requires confirmed R1 and R2, regardless of R3", () => {
 const risk=calculateRisk(factors("R1","R2"),"CONFIRMED_ABSENT");
 assert.equal(risk.score,60); assert.equal(risk.zone,"red");
});
test("AI hypotheses and unknown evidence do not score and request review", () => {
 const risk=calculateRisk([{code:"R2",status:"AI_HYPOTHESIS"},{code:"R3",status:"UNKNOWN"},{code:"R4",status:"REJECTED"}],"CONFIRMED_VALID");
 assert.equal(risk.score,0); assert.equal(risk.zone,"green"); assert.equal(risk.needsReview,true);
});
test("codes contribute once, regardless of supplied weight or repeated sources", () => {
 const risk=calculateRisk([...factors("R1","R2","R3","R4","R5","R6","R2"),{code:"R2",status:"CONFIRMED",weight:999}],"CONFIRMED_ABSENT");
 assert.equal(risk.score,100); assert.equal(risk.scoredFactors.length,6);
 assert.equal(risk.explanation.find(f=>f.code==="R2").evidenceCount,3);
});
