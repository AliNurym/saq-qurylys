import { readFileSync } from "node:fs";
import { paymentFeatures } from "./payment-features.mjs";

const model = JSON.parse(readFileSync(new URL("../models/payment-linear-v1.json", import.meta.url), "utf8"));

export function predictPaymentOffer(text) {
  const features = paymentFeatures(text);
  const known = features.filter((feature) => Object.hasOwn(model.weights, feature));
  const logit = known.reduce((sum, feature) => sum + model.weights[feature], model.bias);
  const probability = 1 / (1 + Math.exp(-logit));
  return { model: model.model, probability, threshold: model.threshold, knownFeatures: known.length, totalFeatures: features.length };
}
