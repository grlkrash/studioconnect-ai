"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiHandler_1 = require("../core/aiHandler");
const router = (0, express_1.Router)();
// POST / route for handling chat messages
router.post('/', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { message, conversationHistory, businessId } = req.body;
        // Basic validation
        if (!message || !businessId) {
            return res.status(400).json({ error: 'Missing required fields: message and businessId' });
        }
        // Call the placeholder AI handler
        const aiResponse = yield (0, aiHandler_1.processMessage)(message, conversationHistory || [], businessId);
        res.status(200).json(aiResponse);
    }
    catch (error) {
        console.error('Error in chat route:', error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
}));
exports.default = router;
