import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const benachrichtigungenRouter = Router();
benachrichtigungenRouter.use(requireAuth);

benachrichtigungenRouter.get("/", (req: AuthedRequest, res) => {
  const rows = db
    .prepare("SELECT * FROM benachrichtigung WHERE empfaenger_id = ? ORDER BY erstellt_am DESC LIMIT 100")
    .all(req.user!.sub);
  res.json(rows);
});

benachrichtigungenRouter.post("/:id/gelesen", (req: AuthedRequest, res) => {
  db.prepare("UPDATE benachrichtigung SET gelesen_am = CURRENT_TIMESTAMP WHERE id = ? AND empfaenger_id = ?").run(
    req.params.id,
    req.user!.sub
  );
  res.json({ ok: true });
});
