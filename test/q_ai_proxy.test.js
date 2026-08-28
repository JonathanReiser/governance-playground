const { expect } = require("chai");
const express = require("express");

describe("server.js — /api/q-ai/deliberate Express Proxy Route", function () {
  it("exports express app with /api/q-ai/deliberate endpoint", function () {
    const app = require("../server.js");
    expect(app).to.be.a("function");
  });
});
