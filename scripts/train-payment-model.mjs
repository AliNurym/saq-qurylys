import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { paymentFeatures } from "../src/payment-features.mjs";
import { paymentTrainingData } from "../src/payment-training-data.mjs";

const rows = paymentTrainingData.map(([text, label]) => ({ features: paymentFeatures(text), label }));
const vocabulary = [...new Set(rows.flatMap((row) => row.features))].sort();
const index = new Map(vocabulary.map((feature, position) => [feature, position]));
const encoded = rows.map((row) => ({ features: row.features.map((feature) => index.get(feature)), label: row.label }));
const weights = vocabulary.map(() => 0);
let bias = 0;
for (let epoch = 0; epoch < 1800; epoch++) {
  const gradient = weights.map(() => 0); let biasGradient = 0;
  for (const row of encoded) {
    const logit = row.features.reduce((sum, position) => sum + weights[position], bias);
    const error = 1 / (1 + Math.exp(-logit)) - row.label;
    biasGradient += error;
    for (const position of row.features) gradient[position] += error;
  }
  bias -= 0.3 * biasGradient / rows.length;
  for (let position = 0; position < weights.length; position++) weights[position] -= 0.3 * (gradient[position] / rows.length + 0.002 * weights[position]);
}
const directory = fileURLToPath(new URL("../models/", import.meta.url));
mkdirSync(directory, { recursive: true });
writeFileSync(directory + "payment-linear-v1.json", JSON.stringify({
  model: "saq-payment-linear-v1", algorithm: "binary logistic regression", trainingSource: "original synthetic phrases",
  trainingExamples: rows.length, featureVersion: 1, threshold: 0.7, bias,
  weights: Object.fromEntries(vocabulary.map((feature, position) => [feature, Number(weights[position].toFixed(8))])),
}, null, 2) + "\n");
console.log("Offline payment classifier trained on " + rows.length + " original synthetic phrases; " + vocabulary.length + " features.");
