export class RateLimiter {
    private requests: Map<string, { count: number; resetTime: number }>;
    private windowMs: number;
    private limit: number;

    constructor(windowMs: number = 60000, limit: number = 10) {
        this.requests = new Map();
        this.windowMs = windowMs;
        this.limit = limit;
    }

    check(ip: string): boolean {
        const now = Date.now();
        const record = this.requests.get(ip);

        if (!record || now > record.resetTime) {
            this.requests.set(ip, { count: 1, resetTime: now + this.windowMs });
            return true;
        }

        if (record.count >= this.limit) {
            return false;
        }

        record.count++;
        return true;
    }
}

// Global instance for the demo (since serverless functions might reuse the container)
const globalLimiter = new RateLimiter();
export default globalLimiter;
