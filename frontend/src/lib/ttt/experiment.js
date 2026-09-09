export function assignFraming(cryptoApi = globalThis.crypto, allowFallback = false) {
  if (cryptoApi?.getRandomValues) {
    const draw = new Uint32Array(1);
    cryptoApi.getRandomValues(draw);
    return { order: draw[0] % 2 === 0 ? "attack-defense" : "defense-attack", source: "web-crypto" };
  }
  if (!allowFallback) throw new Error("Secure randomized assignment is unavailable; research mode cannot start.");
  return { order: Math.random() < 0.5 ? "attack-defense" : "defense-attack", source: "math-random-fallback" };
}

export function randomUint32(cryptoApi = globalThis.crypto, allowFallback = false) {
  if (cryptoApi?.getRandomValues) {
    const draw = new Uint32Array(1);
    cryptoApi.getRandomValues(draw);
    return { value: draw[0], source: "web-crypto" };
  }
  if (!allowFallback) throw new Error("Secure randomization is unavailable; research mode cannot continue.");
  return { value: Math.floor(Math.random() * 2 ** 32), source: "math-random-fallback" };
}
