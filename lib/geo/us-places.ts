const STATES: Record<string, string> = {
  al: "AL", alabama: "AL", ak: "AK", alaska: "AK", az: "AZ", arizona: "AZ", ar: "AR", arkansas: "AR",
  ca: "CA", california: "CA", co: "CO", colorado: "CO", ct: "CT", connecticut: "CT", de: "DE", delaware: "DE",
  dc: "DC", districtofcolumbia: "DC", fl: "FL", florida: "FL", ga: "GA", georgia: "GA", hi: "HI", hawaii: "HI",
  id: "ID", idaho: "ID", il: "IL", illinois: "IL", in: "IN", indiana: "IN", ia: "IA", iowa: "IA",
  ks: "KS", kansas: "KS", ky: "KY", kentucky: "KY", la: "LA", louisiana: "LA", me: "ME", maine: "ME",
  md: "MD", maryland: "MD", ma: "MA", massachusetts: "MA", mi: "MI", michigan: "MI", mn: "MN", minnesota: "MN",
  ms: "MS", mississippi: "MS", mo: "MO", missouri: "MO", mt: "MT", montana: "MT", ne: "NE", nebraska: "NE",
  nv: "NV", nevada: "NV", nh: "NH", newhampshire: "NH", nj: "NJ", newjersey: "NJ", nm: "NM", newmexico: "NM",
  ny: "NY", newyork: "NY", nc: "NC", northcarolina: "NC", nd: "ND", northdakota: "ND", oh: "OH", ohio: "OH",
  ok: "OK", oklahoma: "OK", or: "OR", oregon: "OR", pa: "PA", pennsylvania: "PA", ri: "RI", rhodeisland: "RI",
  sc: "SC", southcarolina: "SC", sd: "SD", southdakota: "SD", tn: "TN", tennessee: "TN", tx: "TX", texas: "TX",
  ut: "UT", utah: "UT", vt: "VT", vermont: "VT", va: "VA", virginia: "VA", wa: "WA", washington: "WA",
  wv: "WV", westvirginia: "WV", wi: "WI", wisconsin: "WI", wy: "WY", wyoming: "WY",
};

const CITIES: Array<[string, string, number, number]> = [
  ["austin", "TX", 30.2672, -97.7431], ["dallas", "TX", 32.7767, -96.797], ["houston", "TX", 29.7604, -95.3698],
  ["san antonio", "TX", 29.4241, -98.4936], ["fort worth", "TX", 32.7555, -97.3308], ["el paso", "TX", 31.7619, -106.485],
  ["miami", "FL", 25.7617, -80.1918], ["orlando", "FL", 28.5383, -81.3792], ["tampa", "FL", 27.9506, -82.4572],
  ["jacksonville", "FL", 30.3322, -81.6557], ["los angeles", "CA", 34.0522, -118.2437], ["san diego", "CA", 32.7157, -117.1611],
  ["san francisco", "CA", 37.7749, -122.4194], ["san jose", "CA", 37.3382, -121.8863], ["sacramento", "CA", 38.5816, -121.4944],
  ["seattle", "WA", 47.6062, -122.3321], ["portland", "OR", 45.5152, -122.6784], ["denver", "CO", 39.7392, -104.9903],
  ["phoenix", "AZ", 33.4484, -112.074], ["tucson", "AZ", 32.2226, -110.9747], ["las vegas", "NV", 36.1699, -115.1398],
  ["chicago", "IL", 41.8781, -87.6298], ["new york", "NY", 40.7128, -74.006], ["brooklyn", "NY", 40.6782, -73.9442],
  ["nyc", "NY", 40.7128, -74.006], ["boston", "MA", 42.3601, -71.0589], ["atlanta", "GA", 33.749, -84.388],
  ["nashville", "TN", 36.1627, -86.7816], ["charlotte", "NC", 35.2271, -80.8431], ["raleigh", "NC", 35.7796, -78.6382],
  ["philadelphia", "PA", 39.9526, -75.1652], ["washington", "DC", 38.9072, -77.0369], ["baltimore", "MD", 39.2904, -76.6122],
  ["detroit", "MI", 42.3314, -83.0458], ["minneapolis", "MN", 44.9778, -93.265], ["kansas city", "MO", 39.0997, -94.5786],
  ["st louis", "MO", 38.627, -90.1994], ["new orleans", "LA", 29.9511, -90.0715], ["oklahoma city", "OK", 35.4676, -97.5164],
  ["albuquerque", "NM", 35.0844, -106.6504], ["salt lake city", "UT", 40.7608, -111.891], ["boise", "ID", 43.615, -116.2023],
  ["honolulu", "HI", 21.3069, -157.8583], ["anchorage", "AK", 61.2181, -149.9003], ["columbus", "OH", 39.9612, -82.9988],
  ["cleveland", "OH", 41.4993, -81.6944], ["cincinnati", "OH", 39.1031, -84.512], ["indianapolis", "IN", 39.7684, -86.1581],
  ["milwaukee", "WI", 43.0389, -87.9065], ["pittsburgh", "PA", 40.4406, -79.9959], ["richmond", "VA", 37.5407, -77.436],
  ["virginia beach", "VA", 36.8529, -75.978], ["charleston", "SC", 32.7765, -79.9311], ["savannah", "GA", 32.0809, -81.0912],
  ["birmingham", "AL", 33.5186, -86.8104], ["memphis", "TN", 35.1495, -90.049], ["louisville", "KY", 38.2527, -85.7585],
  ["omaha", "NE", 41.2565, -95.9345], ["des moines", "IA", 41.5868, -93.625], ["madison", "WI", 43.0731, -89.4012],
  ["scottsdale", "AZ", 33.4942, -111.9261], ["mesa", "AZ", 33.4152, -111.8315], ["irvine", "CA", 33.6846, -117.8265],
  ["oakland", "CA", 37.8044, -122.2712], ["fresno", "CA", 36.7378, -119.7871], ["long beach", "CA", 33.7701, -118.1937],
  ["colorado springs", "CO", 38.8339, -104.8214], ["boulder", "CO", 40.015, -105.2705], ["tucson", "AZ", 32.2226, -110.9747],
];

export type UsPlace = { city: string; state: string; lat: number; lng: number; label: string };

function cityKey(value: string) {
  return value.toLowerCase().replace(/\./g, "").replace(/^(greater|downtown|metro)\s+/, "").replace(/\s+/g, " ").trim();
}

function stateCode(token: string) {
  const key = token.toLowerCase().replace(/[^a-z]/g, "");
  return STATES[key] ?? null;
}

export function locateUsPlace(value: string | null | undefined): UsPlace | null {
  if (!value) return null;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const state = stateCode(parts[1].split(/\s+/)[0] ?? "");
  if (!state) return null;
  const city = cityKey(parts[0] ?? "");
  if (!city || city === "united states" || city === "usa") return null;
  const hit = CITIES.find((item) => item[1] === state && item[0] === city);
  if (!hit) return null;
  return { city: hit[0], state: hit[1], lat: hit[2], lng: hit[3], label: `${parts[0]}, ${hit[1]}` };
}

export function projectUsPlace(place: UsPlace) {
  if (place.state === "AK") return { x: 18, y: 78 };
  if (place.state === "HI") return { x: 28, y: 84 };
  const x = ((place.lng + 125) / 59) * 100;
  const y = ((49.4 - place.lat) / 25.2) * 100;
  return {
    x: Math.min(96, Math.max(4, x)),
    y: Math.min(92, Math.max(6, y)),
  };
}
