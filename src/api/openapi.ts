export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "fiscalND API",
      version: "1.0.0",
      description: "Versioned API contract for fiscalND backend."
    },
    servers: [
      {
        url: "/v1"
      }
    ],
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["code", "message", "details", "requestId"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            details: {},
            requestId: { type: ["string", "null"] }
          }
        }
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Service health"
            }
          }
        }
      },
      "/auth/register": {
        post: {
          summary: "Register user",
          responses: {
            "200": { description: "User registered" },
            "400": { description: "Validation error" }
          }
        }
      },
      "/auth/login": {
        post: {
          summary: "Login user",
          responses: {
            "200": { description: "Login result" },
            "401": { description: "Invalid credentials" }
          }
        }
      },
      "/auth/refresh": {
        post: {
          summary: "Refresh session",
          responses: {
            "200": { description: "Rotated tokens" }
          }
        }
      },
      "/tax/profile": {
        get: {
          summary: "Get tax profile",
          parameters: [
            {
              name: "year",
              in: "query",
              required: true,
              schema: { type: "integer" }
            }
          ],
          responses: {
            "200": { description: "Tax profile" }
          }
        },
        put: {
          summary: "Upsert tax profile",
          parameters: [
            {
              name: "year",
              in: "query",
              required: true,
              schema: { type: "integer" }
            }
          ],
          responses: {
            "200": { description: "Tax profile updated" }
          }
        }
      },
      "/incomes": {
        post: {
          summary: "Create income",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Income created" }
          }
        },
        get: {
          summary: "List incomes",
          responses: {
            "200": { description: "Incomes list" }
          }
        }
      },
      "/transactions": {
        post: {
          summary: "Create transaction",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Transaction created" }
          }
        },
        get: {
          summary: "List transactions with pagination",
          responses: {
            "200": { description: "Paginated transactions" }
          }
        }
      },
      "/documents/confirm": {
        post: {
          summary: "Confirm uploaded document",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Document confirmed" }
          }
        }
      },
      "/imports/bank-csv": {
        post: {
          summary: "Import bank transactions from CSV",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "CSV import summary" }
          }
        }
      },
      "/tax/compute": {
        post: {
          summary: "Compute tax estimate",
          parameters: [
            {
              name: "year",
              in: "query",
              required: true,
              schema: { type: "integer" }
            },
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Tax computation result" },
            "409": { description: "Idempotency conflict or reused key" }
          }
        }
      },
      "/exports/tax-pack": {
        post: {
          summary: "Generate downloadable tax pack PDF",
          parameters: [
            {
              name: "year",
              in: "query",
              required: true,
              schema: { type: "integer" }
            }
          ],
          responses: {
            "200": { description: "Export job completed with artifact metadata" }
          }
        }
      }
    }
  };
}
