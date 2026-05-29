import { handleLearningCentreSafeTest } from "../../lib/learningCentreApiHandlers.mjs";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, status: "method_not_allowed" });
  return handleLearningCentreSafeTest(req, (statusCode: number, payload: any) => res.status(statusCode).json(payload));
}
