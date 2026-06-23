import mongoose from "mongoose";
import ServiceRequest from "../models/ServiceRequest.js";

const escapeRegex = (value = "") => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const buildAggregateBranchMatch = (req) => {
  const match = {};

  if (req.branchScope?.branchId) {
    const branchId = req.branchScope.branchId;

    match.branchId = mongoose.Types.ObjectId.isValid(branchId)
      ? new mongoose.Types.ObjectId(branchId)
      : branchId;
  }

  return match;
};

export const getServiceRequests = async (req, res) => {
  try {
    const { category, search } = req.query;

    const filter = {
      ...req.branchScope,
    };

    if (category && category !== "All Services") {
      filter.serviceCategory = {
        $regex: `^${escapeRegex(category)}$`,
        $options: "i",
      };
    }

    if (search) {
      filter.$or = [
        { ticketNo: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { requesterName: { $regex: search, $options: "i" } },
        { requesterEmail: { $regex: search, $options: "i" } },
        { serviceCategory: { $regex: search, $options: "i" } },
        { status: { $regex: search, $options: "i" } },
      ];
    }

    const requests = await ServiceRequest.find(filter)
      .populate("branchId", "name branchName location")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error("Get service requests error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load service requests right now.",
    });
  }
};

export const getPopularServices = async (req, res) => {
  try {
    const match = buildAggregateBranchMatch(req);

    const popularServices = await ServiceRequest.aggregate([
      {
        $match: match,
      },
      {
        $group: {
          _id: "$serviceCategory",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          serviceCategory: "$_id",
          count: 1,
        },
      },
      {
        $sort: {
          count: -1,
          serviceCategory: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      data: popularServices,
    });
  } catch (error) {
    console.error("Get popular services error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load popular services right now.",
    });
  }
};

export const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    const filter = {
      _id: id,
      ...req.branchScope,
    };

    const request = await ServiceRequest.findOne(filter)
      .populate("branchId", "name branchName location")
      .lean();

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Service request not found or access denied.",
      });
    }

    return res.status(200).json({
      success: true,
      data: request,
    });
  } catch (error) {
    console.error("Get request by ID error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load service request details right now.",
    });
  }
};