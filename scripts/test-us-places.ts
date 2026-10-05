import assert from "node:assert/strict";
import { locateUsPlace, projectUsPlace } from "../lib/geo/us-places";

const austin = locateUsPlace("Austin, TX");
assert.ok(austin);
assert.equal(austin?.state, "TX");
assert.equal(locateUsPlace("Austin, Texas")?.label, "Austin, TX");
assert.equal(locateUsPlace("United States"), null);
assert.equal(locateUsPlace("Texas"), null);
assert.equal(locateUsPlace("Somewhere nice"), null);
assert.equal(locateUsPlace("Springfield, ZZ"), null);
const point = projectUsPlace(austin!);
assert.ok(point.x > 0 && point.x < 100);
assert.ok(point.y > 0 && point.y < 100);
console.log("us place tests passed");
