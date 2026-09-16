import { useMemo } from "react";
import { Country, State, City } from "country-state-city";
import { MapPin } from "lucide-react";
import { ComboboxField, TextField } from "./FormFields.jsx";

// Reusable address field group: country -> state -> city cascade (via the
// country-state-city package) plus colonia/calle/numeros/codigo postal as
// plain text fields. Designed to be registered as a `type: "component"`
// section in any RunlyForm blueprint — see
// docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md.
//
// Contract: `value` holds only the fields this component owns (country,
// state, city, colony, street, extNumber, intNumber, postalCode); `onChange`
// is called with a partial patch of those same keys to merge into the
// parent form's state.
export function AddressFieldsSection({ value = {}, errors = {}, onChange, disabled = false }) {
  const country = value.country ?? "";
  const state = value.state ?? "";
  const city = value.city ?? "";

  const countryOptions = useMemo(
    () => Country.getAllCountries().map((c) => ({ value: c.isoCode, label: c.name })),
    [],
  );
  const stateOptions = useMemo(
    () => (country ? State.getStatesOfCountry(country).map((s) => ({ value: s.isoCode, label: s.name })) : []),
    [country],
  );
  const cityOptions = useMemo(
    () => (country && state ? City.getCitiesOfState(country, state).map((c) => ({ value: c.name, label: c.name })) : []),
    [country, state],
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ComboboxField
        label="País"
        options={countryOptions}
        value={country}
        disabled={disabled}
        onChange={(val) => onChange({ country: val, state: "", city: "", colony: value.colony ?? "" })}
        placeholder="Seleccionar país..."
        searchPlaceholder="Buscar país..."
        error={errors.country}
      />
      {stateOptions.length > 0 ? (
        <ComboboxField
          label="Estado / Provincia"
          options={stateOptions}
          value={state}
          disabled={disabled}
          onChange={(val) => onChange({ state: val, city: "", colony: value.colony ?? "" })}
          placeholder="Seleccionar estado..."
          searchPlaceholder="Buscar estado..."
          error={errors.state}
        />
      ) : (
        <TextField
          label="Estado / Provincia"
          icon={MapPin}
          value={state}
          disabled={disabled}
          onChange={(e) => onChange({ state: e.target.value })}
          error={errors.state}
        />
      )}
      {country && cityOptions.length > 0 ? (
        <ComboboxField
          label="Ciudad / Municipio"
          options={cityOptions}
          value={city}
          disabled={disabled}
          onChange={(val) => onChange({ city: val })}
          placeholder="Seleccionar ciudad..."
          searchPlaceholder="Buscar ciudad..."
          minSearchLength={2}
          error={errors.city}
        />
      ) : (
        <TextField
          label="Ciudad / Municipio"
          icon={MapPin}
          value={city}
          disabled={disabled}
          onChange={(e) => onChange({ city: e.target.value })}
          error={errors.city}
        />
      )}
      <TextField
        label="Colonia / Fraccionamiento"
        icon={MapPin}
        value={value.colony ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ colony: e.target.value })}
        error={errors.colony}
      />
      <TextField
        label="Calle"
        icon={MapPin}
        value={value.street ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ street: e.target.value })}
        error={errors.street}
      />
      <TextField
        label="Número exterior"
        value={value.extNumber ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ extNumber: e.target.value })}
        error={errors.extNumber}
      />
      <TextField
        label="Número interior"
        value={value.intNumber ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ intNumber: e.target.value })}
        error={errors.intNumber}
      />
      <TextField
        label="Código postal"
        value={value.postalCode ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ postalCode: e.target.value })}
        error={errors.postalCode}
      />
    </div>
  );
}
