const { expect } = require("chai");
const reference = require("./fixtures/quantumArenaPythonReference.json");
const {
  BASIS, FLIP, MAX_ENTANGLEMENT, MENU, explain, outcomeProbabilities, play, playOut, unitary,
} = require("../server/quantumArena");

describe("serverless quantum arena", function () {
  it("matches the independent Python/NumPy reference", function () {
    for (const row of reference.cases) {
      const actual = outcomeProbabilities(row.operationX, row.operationO, row.gamma);
      for (const profile of BASIS) {
        expect(actual[profile], `${row.operationX}/${row.operationO} at gamma=${row.gamma}: ${profile}`)
          .to.be.closeTo(row.probabilities[profile], 1e-12);
      }
    }
  });

  it("generates FLIP from U(pi, 0), not sigma_x", function () {
    expect(FLIP).to.deep.equal(unitary(Math.PI, 0));
    expect(FLIP[0][1]).to.deep.equal({ re: 1, im: 0 });
    expect(FLIP[1][0]).to.deep.equal({ re: -1, im: 0 });
  });

  it("recovers every classical corner across the full entanglement range", function () {
    const corners = [["C", "C", "CC"], ["C", "D", "CD"], ["D", "C", "DC"], ["D", "D", "DD"]];
    for (let step = 0; step <= 40; step += 1) {
      const gamma = MAX_ENTANGLEMENT * step / 40;
      for (const [operationX, operationO, expected] of corners) {
        const probabilities = outcomeProbabilities(operationX, operationO, gamma);
        expect(probabilities[expected]).to.be.closeTo(1, 1e-12);
      }
    }
  });

  it("keeps the frozen menu and policy play-outs exact", function () {
    expect(MENU).to.deep.equal({ C: [0, 0], D: [Math.PI, 0], M: [Math.PI / 2, 0], Q: [0, Math.PI / 2] });
    expect(playOut("C", "C")).to.deep.equal({ moves: [4, 0, 2, 6, 8, 1, 3, 5, 7], board_result: 0 });
    expect(playOut("C", "D")).to.deep.equal({ moves: [4, 0, 2, 6, 8, 3], board_result: -1 });
    expect(playOut("D", "C")).to.deep.equal({ moves: [4, 0, 2, 6, 3, 8, 5], board_result: 1 });
    expect(playOut("D", "D")).to.deep.equal({ moves: [4, 0, 2, 6, 3, 5, 8, 1, 7], board_result: 0 });
  });

  it("produces one-shot play records under the arena schema", function () {
    const record = play({ operationX: "C", operationO: "D", gamma: 0 }, () => 0.5);
    expect(record.schema).to.equal("quantum-arena-play/v1");
    expect(record.execution).to.include({ simulator: true, shots: 1, backend: "serverless-js-statevector" });
    expect(record.measured_profile).to.equal("CD");
    expect(record.payoffs).to.deep.equal({ X: -1, O: 2 / 3 });
  });

  it("keeps explanation samples out of research observations", function () {
    const result = explain({ operationX: "M", operationO: "M", gamma: 0, shots: 8 }, () => 0.1);
    expect(result.schema).to.equal("quantum-arena-explanation/v1");
    expect(result.not_a_research_observation).to.equal(true);
    expect(result.shots).to.equal(8);
    expect(() => explain({ operationX: "C", operationO: "C", gamma: 0, shots: 1 })).to.throw(/between 2 and 20000/);
  });

  it("rejects requests outside the frozen protocol", function () {
    expect(() => play({ operationX: "Z", operationO: "C", gamma: 0 })).to.throw(/frozen menu/);
    expect(() => play({ operationX: "C", operationO: "C", gamma: Infinity })).to.throw(/number/);
    expect(() => play({ operationX: "C", operationO: "C", gamma: Math.PI })).to.throw(/pi\/2/);
  });
});

describe("serverless quantum arena HTTP routes", function () {
  let server;
  let baseUrl;

  before(function (done) {
    const app = require("../server.js");
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after(function (done) {
    server.close(done);
  });

  it("serves a play with no Python bridge", async function () {
    const response = await fetch(`${baseUrl}/api/arena/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationX: "C", operationO: "D", gamma: 0 }),
    });
    expect(response.status).to.equal(200);
    const record = await response.json();
    expect(record).to.include({ schema: "quantum-arena-play/v1", measured_profile: "CD" });
    expect(record.execution.backend).to.equal("serverless-js-statevector");
  });

  it("serves a separate explanation and validates bad input", async function () {
    const response = await fetch(`${baseUrl}/api/arena/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationX: "M", operationO: "M", gamma: 0, shots: 8 }),
    });
    expect(response.status).to.equal(200);
    expect((await response.json()).schema).to.equal("quantum-arena-explanation/v1");

    const invalid = await fetch(`${baseUrl}/api/arena/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationX: "prototype", operationO: "C", gamma: 0 }),
    });
    expect(invalid.status).to.equal(400);
    expect((await invalid.json()).error).to.match(/frozen menu/);
  });
});
