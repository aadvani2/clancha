import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

// Set up test environment variables
process.env.JWT_SECRET = "test-jwt-secret-for-testing-purposes-only";
process.env.MONGODB_URI = "mongodb://localhost:27017/test";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.TWILIO_ACCOUNT_SID = "test-twilio-sid";
process.env.TWILIO_AUTH_TOKEN = "test-twilio-token";
process.env.TWILIO_VERIFY_SERVICE_SID = "VA00000000000000000000000000000000";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_testing";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake_secret_for_testing";
process.env.STRIPE_PRICE_CORE = "price_core_test";
process.env.STRIPE_PRICE_PICTURE_ADDON = "price_addon_test";

// Clean up after each test
afterEach(() => {
  // Reset any mocks
});
