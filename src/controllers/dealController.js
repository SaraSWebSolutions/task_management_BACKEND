const Deal = require("../models/Deal");

const { STAGES, STAGE_PROBABILITY } = Deal;
const WON = "CLOSED_WON";
const LOST = "CLOSED_LOST";

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const statusOf = (stage) =>
  stage === WON ? "WON" : stage === LOST ? "LOST" : "IN_PROGRESS";

const present = (d) => ({ ...d.toObject(), status: statusOf(d.stage) });

// Whitelist body fields; probability follows the stage unless set by hand.
const clean = (body, current) => {
  const data = {};
  for (const k of ["name", "company", "value", "stage", "owner", "closeDate", "lead", "notes"]) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  if (data.stage && !STAGES.includes(data.stage)) throw new Error("Invalid stage");

  const stage = data.stage || current?.stage || "DISCOVERY";
  if (body.probability !== undefined && body.probability !== "") {
    data.probability = Math.min(100, Math.max(0, Number(body.probability)));
  } else if (data.stage || !current) {
    data.probability = STAGE_PROBABILITY[stage];
  }
  // Closed deals always have a fixed probability.
  if (stage === WON) data.probability = 100;
  if (stage === LOST) data.probability = 0;
  return data;
};

const buildStats = (deals) => {
  const won = deals.filter((d) => d.stage === WON);
  const lost = deals.filter((d) => d.stage === LOST);
  const open = deals.filter((d) => ![WON, LOST].includes(d.stage));
  const sum = (list) => list.reduce((s, d) => s + (d.value || 0), 0);
  const closed = won.length + lost.length;

  return {
    total: deals.length,
    won: won.length,
    wonValue: sum(won),
    lost: lost.length,
    lossRate: closed ? Math.round((lost.length / closed) * 1000) / 10 : 0,
    inProgress: open.length,
    avgProbability: open.length
      ? Math.round(open.reduce((s, d) => s + (d.probability || 0), 0) / open.length)
      : 0,
    pipelineValue: sum(open),
    byStage: STAGES.map((stage) => {
      const list = deals.filter((d) => d.stage === stage);
      return { stage, count: list.length, value: sum(list) };
    }),
  };
};

exports.getDeals = async (req, res) => {
  try {
    const deals = await Deal.find()
      .populate("owner", "name")
      .populate("lead", "name company")
      .sort({ createdAt: -1 });

    res.json({ success: true, deals: deals.map(present), stats: buildStats(deals) });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.addDeal = async (req, res) => {
  try {
    if (!req.body.name?.trim()) return fail(res, 400, "Deal name is required");
    const deal = await Deal.create({ ...clean(req.body), createdBy: req.user.id });
    res.status(201).json({ success: true, message: "Deal created", deal });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateDeal = async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) return fail(res, 404, "Deal not found");
    if (req.body.name !== undefined && !req.body.name.trim())
      return fail(res, 400, "Deal name is required");

    deal.set(clean(req.body, deal));
    await deal.save();
    res.json({ success: true, message: "Deal updated", deal });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteDeal = async (req, res) => {
  try {
    await Deal.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Deal deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
