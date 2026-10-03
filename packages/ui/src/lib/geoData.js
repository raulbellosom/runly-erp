import { useEffect, useState } from "react";

// country-state-city ships ~8.7 MB of JSON (8 MB of it is the city list). A
// static import lands it in the chunk shared by every screen, so it is loaded
// on demand instead: countries + states (~650 KB) when an address form mounts,
// cities only once a state is selected. Deep imports keep the two apart.
const cache = { Country: null, State: null, City: null };
let regionsPromise = null;
let citiesPromise = null;

export function loadGeoRegions() {
  regionsPromise ??= Promise.all([
    import("country-state-city/lib/country.js"),
    import("country-state-city/lib/state.js"),
  ])
    .then(([country, state]) => {
      cache.Country = country.default;
      cache.State = state.default;
      return cache;
    })
    .catch((error) => {
      regionsPromise = null;
      throw error;
    });
  return regionsPromise;
}

export function loadGeoCities() {
  citiesPromise ??= import("country-state-city/lib/city.js")
    .then((city) => {
      cache.City = city.default;
      return cache;
    })
    .catch((error) => {
      citiesPromise = null;
      throw error;
    });
  return citiesPromise;
}

// Returns { Country, State, City }; each is null until its data has loaded.
// Callers treat null as "no options yet" (the address fields fall back to
// plain text inputs meanwhile).
export function useGeoData({ cities = false } = {}) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const pending = [];
    if (!cache.Country) pending.push(loadGeoRegions());
    if (cities && !cache.City) pending.push(loadGeoCities());
    if (pending.length === 0) return undefined;
    let alive = true;
    Promise.all(pending)
      .then(() => { if (alive) setVersion((v) => v + 1); })
      .catch(() => {});
    return () => { alive = false; };
  }, [cities]);
  return { Country: cache.Country, State: cache.State, City: cities ? cache.City : null };
}
