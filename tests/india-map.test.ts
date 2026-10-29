import { describe, expect, it } from "vitest";
import { INDIA_MAP_STATES } from "@/lib/geo/india-map";
import { CURATED_CITIES, cityKey, cityLabel, knownCity, mapShapesForState, projectToMap, stateKey } from "@/lib/geo/india-places";

/** The map's paths use only m / l / L / z: rings of points. */
function rings(d: string): Array<Array<[number, number]>> {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> | null = null;
  let cmd = "";
  let x = 0, y = 0, sx = 0, sy = 0;
  for (let i = 0; i < toks.length;) {
    const t = toks[i];
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "z" || cmd === "Z") {
        if (cur) out.push(cur);
        cur = null;
        x = sx; y = sy;
      }
      continue;
    }
    const a = Number(toks[i]), b = Number(toks[i + 1]);
    i += 2;
    if (cmd === "m" || cmd === "M") {
      if (cmd === "m") { x += a; y += b; } else { x = a; y = b; }
      if (cur) out.push(cur);
      cur = [[x, y]];
      sx = x; sy = y;
      cmd = cmd === "m" ? "l" : "L";
    } else if (cmd === "l") {
      x += a; y += b; cur?.push([x, y]);
    } else if (cmd === "L") {
      x = a; y = b; cur?.push([x, y]);
    } else {
      throw new Error(`unexpected path command ${cmd}`);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function inside(px: number, py: number, shape: string): boolean {
  let hit = false;
  for (const ring of rings(shape)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

describe("India client map", () => {
  it("draws every state and union territory", () => {
    expect(INDIA_MAP_STATES).toHaveLength(36);
  });

  it("places every curated city inside its own state's shape", () => {
    const shape = new Map(INDIA_MAP_STATES.map((s) => [s.id, s.d]));
    const outside = CURATED_CITIES.filter((c) => {
      const { x, y } = projectToMap(c.lat, c.lon);
      return !mapShapesForState(c.state).some((id) => inside(x, y, shape.get(id) ?? ""));
    });
    expect(outside.map((c) => c.name)).toEqual([]);
  });

  it("maps today's state names onto the map's shapes", () => {
    expect(mapShapesForState("Ladakh")).toEqual(["jk"]);
    expect(mapShapesForState("Dadra and Nagar Haveli and Daman and Diu")).toEqual(["dn", "dd"]);
    expect(mapShapesForState("maharashtra")).toEqual(["mh"]);
    expect(mapShapesForState("Nowhere")).toEqual([]);
    expect(stateKey("  gujarat ")).toBe("Gujarat");
  });

  it("reads city spellings the way clients type them", () => {
    expect(cityKey("Bombay")).toBe("mumbai");
    expect(cityKey("Bangalore Urban")).toBe("bengaluru");
    expect(cityKey("Vadodara City")).toBe("vadodara");
    expect(cityKey("NA")).toBeNull();
    expect(cityKey("")).toBeNull();
    expect(knownCity(cityKey("Gurgaon"))?.state).toBe("Haryana");
    expect(cityLabel("navsari")).toBe("Navsari");
    expect(cityLabel("some town")).toBe("Some Town");
  });
});
