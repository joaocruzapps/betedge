import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "betedge-api",
    time: new Date().toISOString(),
  });
});

app.post("/flashscore/parse", async (req, res) => {
  try {
    const { url, bookmaker = "betano_pt" } = req.body || {};

    if (!url || typeof url !== "string") {
      return res.status(400).json({ ok: false, error: "Missing/invalid url" });
    }

    const m = url.match(/\/jogo\/futebol\/([^\/]+)\/([^\/]+)\//i);

    const cleanTeam = (slug) =>
      slug
        .replace(/-[^-]*$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

    const homeTeam = m?.[1] ? cleanTeam(m[1]) : null;
    const awayTeam = m?.[2] ? cleanTeam(m[2]) : null;

    if (!homeTeam || !awayTeam) {
      return res.status(422).json({ ok: false, error: "Could not parse teams from URL" });
    }

    const kickoff = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

    return res.json({
      ok: true,
      match: {
        matchId: `flashscore:${Date.now()}`,
        flashscoreUrl: url,
        homeTeam,
        awayTeam,
        kickoff,
        competition: null,
        odds: {
          bookmaker,
          available: false,
          markets: {},
        },
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/analyze/match", async (req, res) => {
  try {
    const { match, riskProfile = "balanced" } = req.body || {};
    if (!match?.homeTeam || !match?.awayTeam) {
      return res.status(400).json({ ok: false, error: "Missing match.homeTeam/awayTeam" });
    }

    const odds = 2.05;
    const modelProb = riskProfile === "aggressive" ? 0.57 : riskProfile === "conservative" ? 0.53 : 0.55;
    const impliedProb = 1 / odds;
    const ev = modelProb - impliedProb;

    return res.json({
      ok: true,
      recommendations: [
        {
          matchId: match.matchId ?? `m:${Date.now()}`,
          matchLabel: `${match.homeTeam} vs ${match.awayTeam}`,
          market: "1X2",
          selection: "Casa",
          odds,
          modelProb,
          impliedProb,
          ev,
          xgHome: 1.55,
          xgAway: 1.05,
          notes: "MVP: mock. Próximo passo: Dixon‑Coles + xG real + odds Betano.",
        },
      ],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "Betedge API running",
    endpoints: ["GET /health", "POST /flashscore/parse", "POST /analyze/match"],
  });
});

app.listen(PORT, () => {
  console.log(`betedge-api listening on port ${PORT}`);
});
