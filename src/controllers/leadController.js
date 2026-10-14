const Lead = require("../models/Lead");
const User = require("../models/User");
const Project = require("../models/Project");
const { buildEntries } = require("../utils/costing");

const MAX_DOC = 7_000_000; // characters of base64, roughly 5 MB file

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const dupMessage = "A lead with this email already exists";

exports.addLead = async (req, res) => {
  try {
    const data = { ...req.body };

    if (data.requestType !== "DEMO") data.demoType = undefined;
    if (data.requestType === "DEMO" && !data.demoType)
      return fail(res, 400, "Select demo type (Online / Offline)");

    const lead = await Lead.create({ ...data, createdBy: req.user.id });

    res
      .status(201)
      .json({ success: true, message: "Lead created successfully", lead });
  } catch (error) {
    fail(res, 400, error.code === 11000 ? dupMessage : error.message);
  }
};

exports.getLeads = async (req, res) => {
  try {
    const leads = await Lead.find()
      .select("-spendDoc")
      .populate("assignedTo", "name")
      .sort({ createdAt: -1 });

    res.json({ success: true, leads });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.getLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("assignedTo", "name")
      .populate("marketing.user", "name");
    if (!lead) return fail(res, 404, "Lead not found");

    res.json({ success: true, lead });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// Basic details only. The flow (demo / quotation / sales / project) has its own endpoints.
exports.updateLead = async (req, res) => {
  try {
    const { name, company, email, phone, source, requestType, demoType, notes } =
      req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return fail(res, 404, "Lead not found");

    if (requestType === "DEMO" && !demoType)
      return fail(res, 400, "Select demo type (Online / Offline)");

    Object.assign(lead, { name, company, email, phone, notes, ...(source && { source }) });
    lead.requestType = requestType || lead.requestType;
    lead.demoType = lead.requestType === "DEMO" ? demoType : undefined;

    await lead.save();
    res.json({ success: true, message: "Lead updated successfully", lead });
  } catch (error) {
    fail(res, 400, error.code === 11000 ? dupMessage : error.message);
  }
};

exports.deleteLead = async (req, res) => {
  try {
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// People who can be assigned a demo or added to a project team (no salary here)
exports.getAssignees = async (req, res) => {
  try {
    const users = await User.find(
      { status: "ACTIVE", role: { $in: ["EMPLOYEE", "MANAGER"] } },
      "name designation",
    ).sort({ name: 1 });

    res.json({ success: true, users });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// Demo step: online -> assigned to; offline -> assigned to, location, spend amount + copy
exports.saveDemo = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return fail(res, 404, "Lead not found");
    if (lead.requestType !== "DEMO")
      return fail(res, 400, "This lead did not ask for a demo");
    if (["SALES", "PROJECT", "LOST"].includes(lead.status))
      return fail(res, 400, "Demo can no longer be changed for this lead");

    const {
      assignedTo,
      demoDate,
      location,
      spendAmount,
      spendDoc,
      spendDocName,
    } = req.body;

    if (!assignedTo) return fail(res, 400, "Select who is assigned");
    lead.assignedTo = assignedTo;
    lead.demoDate = demoDate ? new Date(demoDate) : lead.demoDate || new Date();

    if (lead.demoType === "OFFLINE") {
      if (!location?.trim()) return fail(res, 400, "Location is required");

      const amount = Number(spendAmount);
      if (spendAmount === "" || spendAmount == null || !(amount >= 0))
        return fail(res, 400, "Enter the spend amount");

      if (!spendDoc && !lead.spendDoc)
        return fail(res, 400, "Upload the expense copy");
      if (spendDoc && spendDoc.length > MAX_DOC)
        return fail(res, 400, "Expense copy is too large (max 5 MB)");

      lead.location = location.trim();
      lead.spendAmount = amount;
      if (spendDoc) {
        lead.spendDoc = spendDoc;
        lead.spendDocName = spendDocName;
      }
    }

    if (lead.status === "NEW") lead.status = "DEMO_SCHEDULED";
    await lead.save();

    res.json({ success: true, message: "Demo details saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.sendQuotation = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return fail(res, 404, "Lead not found");
    if (!["NEW", "DEMO_SCHEDULED", "QUOTATION_SENT"].includes(lead.status))
      return fail(res, 400, "Quotation cannot be sent at this stage");

    lead.status = "QUOTATION_SENT";
    lead.quotationSentAt = new Date();
    await lead.save();

    res.json({ success: true, message: "Quotation marked as sent" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.convertToSales = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return fail(res, 404, "Lead not found");
    if (!["DEMO_SCHEDULED", "QUOTATION_SENT"].includes(lead.status))
      return fail(res, 400, "Complete the demo or send a quotation first");

    lead.status = "SALES";
    await lead.save();

    res.json({ success: true, message: "Lead converted to sales" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.convertToProject = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return fail(res, 404, "Lead not found");
    if (lead.status !== "SALES")
      return fail(res, 400, "Convert the lead to sales first");

    const { name, projectValue, clientEstimationHours, teamEstimationHours } =
      req.body;
    if (!name?.trim()) return fail(res, 400, "Project name is required");

    const project = await Project.create({
      name: name.trim(),
      lead: lead._id,
      clientName: lead.company || lead.name,
      projectValue: Number(projectValue) || 0,
      clientEstimationHours: Number(clientEstimationHours) || 0,
      teamEstimationHours: Number(teamEstimationHours) || 0,
    });

    lead.status = "PROJECT";
    lead.project = project._id;
    await lead.save();

    res.status(201).json({
      success: true,
      message: "Project created",
      project,
    });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Marketing time spent on this lead / project (person + hours + date + note)
exports.setMarketing = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return fail(res, 404, "Lead not found");

    lead.marketing = await buildEntries(req.body.marketing, lead.marketing);

    await lead.save();
    res.json({ success: true, message: "Marketing time saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};
