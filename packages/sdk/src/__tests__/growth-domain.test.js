import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createGrowthDomain } from "../domains/growth.js";
import { createRunlyClient } from "../index.js";

function makeFetch() {
  return mock.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({ url }),
    text: async () => "",
    blob: async () => new Blob([url]),
  }));
}

describe("atlas SDK - growth domain", () => {
  it("exports all lead inbox methods", () => {
    const domain = createGrowthDomain({
      request: async () => ({}),
      requestBlob: async () => new Blob(),
      withAuthHeaders: () => ({}),
      toQueryString: () => "",
    });
    assert.deepEqual(Object.keys(domain).sort(), [
      "addLeadNote",
      "convertLead",
      "createForm",
      "createLead",
      "createLeadComment",
      "createProperty",
      "deleteForm",
      "deleteLeadComment",
      "exportAnalyticsCsv",
      "getAnalyticsAcquisition",
      "getAnalyticsContent",
      "getAnalyticsConversions",
      "getAnalyticsOverview",
      "getAnalyticsRetention",
      "getForm",
      "getLead",
      "getLeadSummary",
      "listAnalyticsSites",
      "listFormAssignees",
      "listForms",
      "listLeadAssignees",
      "listLeadComments",
      "listLeads",
      "listProperties",
      "setLeadEnabled",
      "toggleLeadCommentReaction",
      "updateLead",
      "updateLeadComment",
      "updateProperty",
      "verifyProperty",
    ]);
  });

  it("sends the expected request shape for every method", async () => {
    const fetchMock = makeFetch();
    globalThis.fetch = fetchMock;
    const client = createRunlyClient({ baseUrl: "http://api" });
    const token = "tok";

    await client.growth.getLeadSummary(token, { from: "2026-06-01" });
    await client.growth.listLeads(token, { status: "new", page: 2 });
    await client.growth.listLeadAssignees(token);
    await client.growth.getLead("lead/1", token);
    await client.growth.createLead({ name: "Ana" }, token);
    await client.growth.updateLead("lead/1", { priority: "high" }, token);
    await client.growth.addLeadNote(
      "lead/1",
      { note: "Llamar", updatedAt: "2026-06-14T21:30:00.000Z" },
      token,
    );
    await client.growth.convertLead(
      "lead/1",
      { mode: "existing", contactId: "contact-1" },
      token,
    );
    await client.growth.setLeadEnabled(
      "lead/1",
      { enabled: false, updatedAt: "2026-06-14T21:30:00.000Z" },
      token,
    );
    await client.growth.listAnalyticsSites(token);
    const analyticsQuery = {
      from: "2026-06-01",
      to: "2026-06-14",
      compare: true,
    };
    await client.growth.getAnalyticsOverview(token, analyticsQuery);
    await client.growth.getAnalyticsAcquisition(token, analyticsQuery);
    await client.growth.getAnalyticsContent(token, analyticsQuery);
    await client.growth.getAnalyticsConversions(token, analyticsQuery);
    await client.growth.getAnalyticsRetention(token, analyticsQuery);
    await client.growth.exportAnalyticsCsv(token, {
      ...analyticsQuery,
      report: "overview",
    });
    await client.growth.listProperties(token);
    await client.growth.createProperty({ name: "runly.mx", domain: "runly.mx" }, token);
    await client.growth.updateProperty("prop-1", { name: "Sitio" }, token);
    await client.growth.verifyProperty("prop-1", token);
    await client.growth.listForms(token, { propertyId: "prop-1" });
    await client.growth.listFormAssignees(token);
    await client.growth.getForm("form-1", token);
    await client.growth.createForm({ propertyId: "prop-1", name: "Contacto" }, token);
    await client.growth.deleteForm("form-1", token);

    const calls = fetchMock.mock.calls.map((call) => call.arguments);
    assert.equal(
      calls[0][0],
      "http://api/growth/leads/summary?from=2026-06-01",
    );
    assert.equal(
      calls[1][0],
      "http://api/growth/leads?status=new&page=2",
    );
    assert.equal(calls[2][0], "http://api/growth/leads/assignees");
    assert.equal(calls[3][0], "http://api/growth/leads/lead%2F1");
    assert.equal(calls[4][1].method, "POST");
    assert.deepEqual(JSON.parse(calls[4][1].body), { name: "Ana" });
    assert.equal(calls[5][1].method, "PATCH");
    assert.equal(calls[6][0], "http://api/growth/leads/lead%2F1/notes");
    assert.equal(calls[6][1].method, "POST");
    assert.equal(calls[7][0], "http://api/growth/leads/lead%2F1/convert");
    assert.equal(calls[7][1].method, "POST");
    assert.equal(calls[8][0], "http://api/growth/leads/lead%2F1/enabled");
    assert.equal(calls[8][1].method, "PATCH");
    assert.equal(
      calls[9][0],
      "http://api/growth/analytics/sites",
    );
    assert.equal(
      calls[10][0],
      "http://api/growth/analytics/overview?from=2026-06-01&to=2026-06-14&compare=true",
    );
    assert.equal(
      calls[11][0],
      "http://api/growth/analytics/acquisition?from=2026-06-01&to=2026-06-14&compare=true",
    );
    assert.equal(
      calls[12][0],
      "http://api/growth/analytics/content?from=2026-06-01&to=2026-06-14&compare=true",
    );
    assert.equal(
      calls[13][0],
      "http://api/growth/analytics/conversions?from=2026-06-01&to=2026-06-14&compare=true",
    );
    assert.equal(
      calls[14][0],
      "http://api/growth/analytics/retention?from=2026-06-01&to=2026-06-14&compare=true",
    );
    assert.equal(
      calls[15][0],
      "http://api/growth/analytics/export.csv?from=2026-06-01&to=2026-06-14&compare=true&report=overview",
    );
    assert.equal(calls[16][0], "http://api/growth/properties");
    assert.equal(calls[17][0], "http://api/growth/properties");
    assert.equal(calls[17][1].method, "POST");
    assert.deepEqual(JSON.parse(calls[17][1].body), {
      name: "runly.mx",
      domain: "runly.mx",
    });
    assert.equal(calls[18][0], "http://api/growth/properties/prop-1");
    assert.equal(calls[18][1].method, "PATCH");
    assert.equal(calls[19][0], "http://api/growth/properties/prop-1/verify");
    assert.equal(calls[19][1].method, "POST");
    assert.equal(calls[20][0], "http://api/growth/forms?propertyId=prop-1");
    assert.equal(calls[21][0], "http://api/growth/forms/assignees");
    assert.equal(calls[22][0], "http://api/growth/forms/form-1");
    assert.equal(calls[23][0], "http://api/growth/forms");
    assert.equal(calls[23][1].method, "POST");
    assert.deepEqual(JSON.parse(calls[23][1].body), {
      propertyId: "prop-1",
      name: "Contacto",
    });
    assert.equal(calls[24][0], "http://api/growth/forms/form-1");
    assert.equal(calls[24][1].method, "DELETE");
    for (const [, options] of calls) {
      assert.equal(options.headers.Authorization, "Bearer tok");
    }

    fetchMock.mock.restore();
  });
});
