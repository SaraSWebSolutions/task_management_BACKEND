const Client = require("../models/Clients");

exports.addClient = async (req, res) => {
  try {
    const client = await Client.create({
      ...req.body,
    });

    res.status(201).json({
      success: true,
      message: "Client added successfully",
      client,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getClients = async (req, res) => {
  try {
    const clients = await Client.find().sort({
      renewalDate: 1,
    });

    const today = new Date();

    const formatted = clients.map((client) => {
      const daysLeft = Math.ceil(
        (new Date(client.renewalDate) - today) / (1000 * 60 * 60 * 24),
      );

      return {
        ...client.toObject(),
        daysLeft,
        isExpiringSoon: daysLeft <= 20,
      };
    });

    res.json({
      success: true,
      clients: formatted,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getClient = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    res.json({
      success: true,
      client,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, {
      returnDocument: "after",
    });

    res.json({
      success: true,
      message: "Client updated successfully",
      client,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    await Client.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Client deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
