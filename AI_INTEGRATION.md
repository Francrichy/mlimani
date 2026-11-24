# Mlimani AI Connector

This adds an authenticated REST integration reference and an MCP (Model Context Protocol) endpoint to the existing Mlimani service.

## Endpoints

- MCP endpoint: `POST https://app.mlimani.net/api/mcp`
- Integration status: `GET https://app.mlimani.net/api/integrations/status`
- OpenAPI description: `GET https://app.mlimani.net/api/integrations/openapi.json`
- Pending owner approvals: `GET https://app.mlimani.net/api/integrations/approvals`

The connector validates the signed-in user's current company membership and module permissions on every request. Never put passwords or tokens in source control, public prompts, or shared screenshots.

## Generate a secure Mlimani AI token

1. Sign in to your Mlimani Fleet company account as the company owner.
2. Open **AI Integration** from the left-hand Fleet menu.
3. Under **Mlimani AI access token**, select **Generate Mlimani AI token**.
4. Copy the token shown once.
5. Paste it into **Mlimani AI → Plugins → Mlimani Fleet Management**.

The direct page `https://app.mlimani.net/ai-connect.html` remains available as an alternative. No Mlimani AI API key is entered in Fleet or in Render.

The token expires after 7 days. Generate a fresh one and reconnect when it expires. It is restricted to the MCP endpoint and cannot call ordinary Fleet REST routes or approve/reject owner actions. It is signed with the existing JWT secret and is not stored in PostgreSQL or the Fleet database. No customer records or passwords are changed.

## MCP client configuration

Configure the MCP client with the endpoint and the short-lived integration token:

```json
{
  "mcpServers": {
    "mlimani": {
      "url": "https://app.mlimani.net/api/mcp",
      "headers": {
        "Authorization": "Bearer <MLIMANI_ACCESS_TOKEN>"
      }
    }
  }
}
```

The server implements MCP JSON-RPC initialization, ping, tool listing, and tool calls over HTTP. It is stateless; each request must include the Bearer token.

## Available MCP tools

- `mlimani_list_vehicles`
- `mlimani_list_drivers`
- `mlimani_list_trips`
- `mlimani_list_maintenance`
- `mlimani_list_fuel`
- `mlimani_list_inventory`
- `mlimani_list_expenses`
- `mlimani_list_invoices`
- `mlimani_list_loans`
- `mlimani_finance_summary`
- `mlimani_dashboard`
- `mlimani_request_write_approval`

Read tools respect the signed-in user's module permissions and only return records for that user's company. Company-linked accounts are required.

## Write approval workflow

The AI connector cannot directly write operational data. It can only submit a proposal for one of these actions:

- `create_expense`
- `create_trip`
- `create_invoice`

A proposal is stored as pending for up to 24 hours. No expense, trip, or invoice is created at proposal time. A company owner must sign in and explicitly approve or reject it using their own Bearer token:

```http
GET /api/integrations/approvals
POST /api/integrations/approvals/{approval_id}/approve
POST /api/integrations/approvals/{approval_id}/reject
```

Approvals are scoped to the company. Only the company owner (or authorized platform administrator) can approve or reject. The API rechecks the company boundary when the approval is executed.

## Existing REST API

The connector documents the existing REST endpoints rather than replacing them. Use the OpenAPI endpoint for the endpoint catalogue. Existing routes continue to use Mlimani authentication, module permissions, and subscription checks.

## Important deployment note

The MCP endpoint is available only after this feature branch is merged into `main` and the Render service finishes a successful deployment. The current production service and PostgreSQL database are not modified by this branch until then.
