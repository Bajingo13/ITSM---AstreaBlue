import express from "express";

import {
  getServiceRequests,
  getPopularServices,
  getRequestById,
} from "../controllers/serviceRequestController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";
import { scopeMiddleware } from "../middleware/scopeMiddleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(scopeMiddleware);

router.get("/", getServiceRequests);
router.get("/popular", getPopularServices);
router.get("/:id", getRequestById);

export default router;