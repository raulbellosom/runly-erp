import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  ComboboxField,
  ErrorState,
  PageHeader,
  Skeleton,
  TextField,
} from "@runly/ui";
import { MapPin, Hash, Globe, Navigation, Home } from "lucide-react";
import { Country, State, City } from "country-state-city";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CompanyAddress() {
  const dirtyRef = useRef(false);
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const canManage = Boolean(
    userProfile?.isAdmin ||
      userProfile?.permissions?.includes("company.address.update"),
  );

  const { data, isLoading } = useQuery({
    queryKey: ["company-address"],
    queryFn: () => runly.company.getAddress(token),
    enabled: Boolean(token),
  });

  const [form, setForm] = useState({
    country: "",
    state: "",
    city: "",
    colony: "",
    street: "",
    extNumber: "",
    intNumber: "",
    postalCode: "",
  });

  useEffect(() => {
    if (data?.data && !dirtyRef.current) {
      setForm({
        country: data.data.country ?? "",
        state: data.data.state ?? "",
        city: data.data.city ?? "",
        colony: data.data.colony ?? "",
        street: data.data.street ?? "",
        extNumber: data.data.extNumber ?? "",
        intNumber: data.data.intNumber ?? "",
        postalCode: data.data.postalCode ?? "",
      });
    }
  }, [data]);

  const countryOptions = useMemo(
    () =>
      Country.getAllCountries().map((c) => ({
        value: c.isoCode,
        label: c.name,
      })),
    [],
  );

  const stateOptions = useMemo(
    () =>
      form.country
        ? State.getStatesOfCountry(form.country).map((s) => ({
            value: s.isoCode,
            label: s.name,
          }))
        : [],
    [form.country],
  );

  const cityOptions = useMemo(
    () =>
      form.country && form.state
        ? City.getCitiesOfState(form.country, form.state).map((c) => ({
            value: c.name,
            label: c.name,
          }))
        : [],
    [form.country, form.state],
  );

  function handleCountryChange(val) {
    dirtyRef.current = true;
    setForm((prev) => ({ ...prev, country: val, state: "", city: "" }));
  }

  function handleStateChange(val) {
    dirtyRef.current = true;
    setForm((prev) => ({ ...prev, state: val, city: "" }));
  }

  function handleChange(key, value) {
    dirtyRef.current = true;
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const saveMutation = useMutation({
    mutationFn: (payload) => runly.company.updateAddress(payload, token),
    onSuccess: () => {
      dirtyRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["company-address"] });
      toast.success("Direccion de empresa actualizada.");
    },
    onError: (err) => {
      toast.error(err?.message ?? "No se pudo guardar la direccion.");
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    saveMutation.mutate(form);
  }

  const disabled = !canManage || saveMutation.isPending;
  const locationLine = [form.state, form.country].filter(Boolean).join(", ");
  const streetLine = [form.street, form.extNumber ? `#${form.extNumber}` : ""]
    .filter(Boolean)
    .join(" ");
  const interiorLine = form.intNumber ? `Int. ${form.intNumber}` : null;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6">
        <div className="space-y-6">
          <PageHeader
            eyebrow="Empresa"
            title="Direccion"
            description="Ubicacion fiscal y domicilio de la empresa."
          />

          {!canManage && (
            <ErrorState title="Dirección en modo lectura" description="Tu rol en esta empresa no permite editar la dirección." />
          )}

          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 lg:grid-cols-[1fr_272px] gap-6 items-start"
          >
            {/* ── Left: form cards ─────────────────────────────── */}
            <div className="space-y-6">
              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-2 pb-1 border-b border-[hsl(var(--border))]">
                  <Globe
                    size={14}
                    className="text-[hsl(var(--muted-foreground))]"
                  />
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Ubicacion
                  </h3>
                </div>

                {isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <ComboboxField
                      label="Pais"
                      value={form.country}
                      onChange={handleCountryChange}
                      options={countryOptions}
                      disabled={disabled}
                      placeholder="Selecciona un pais"
                      icon={Globe}
                    />
                    <ComboboxField
                      label="Estado / Provincia"
                      value={form.state}
                      onChange={handleStateChange}
                      options={stateOptions}
                      disabled={disabled || !form.country}
                      placeholder={
                        form.country
                          ? "Selecciona un estado"
                          : "Primero elige un pais"
                      }
                      icon={Navigation}
                    />
                    <ComboboxField
                      label="Ciudad"
                      value={form.city}
                      onChange={(v) => handleChange("city", v)}
                      options={cityOptions}
                      disabled={disabled || !form.state}
                      placeholder={
                        form.state
                          ? "Selecciona una ciudad"
                          : "Primero elige un estado"
                      }
                      icon={MapPin}
                    />
                  </div>
                )}
              </Card>

              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-2 pb-1 border-b border-[hsl(var(--border))]">
                  <Home
                    size={14}
                    className="text-[hsl(var(--muted-foreground))]"
                  />
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Domicilio
                  </h3>
                </div>

                {isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <TextField
                        label="Colonia / Fraccionamiento"
                        value={form.colony}
                        onChange={(e) => handleChange("colony", e.target.value)}
                        disabled={disabled}
                        placeholder="Ej. Col. Doctores"
                        icon={MapPin}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <TextField
                        label="Calle"
                        value={form.street}
                        onChange={(e) => handleChange("street", e.target.value)}
                        disabled={disabled}
                        placeholder="Ej. Av. Insurgentes Sur"
                        icon={MapPin}
                      />
                    </div>
                    <TextField
                      label="Numero exterior"
                      value={form.extNumber}
                      onChange={(e) => handleChange("extNumber", e.target.value)}
                      disabled={disabled}
                      placeholder="Ej. 123"
                      icon={Hash}
                    />
                    <TextField
                      label="Numero interior"
                      value={form.intNumber}
                      onChange={(e) => handleChange("intNumber", e.target.value)}
                      disabled={disabled}
                      placeholder="Ej. Piso 4, Of. 401"
                      icon={Hash}
                    />
                    <TextField
                      label="Codigo postal"
                      value={form.postalCode}
                      onChange={(e) => handleChange("postalCode", e.target.value)}
                      disabled={disabled}
                      placeholder="Ej. 06600"
                      icon={Hash}
                    />
                  </div>
                )}
              </Card>

              {canManage && (
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={saveMutation.isPending || isLoading}
                    loading={saveMutation.isPending}
                  >
                    Guardar direccion
                  </Button>
                </div>
              )}
            </div>

            {/* ── Right: address preview ────────────────────────── */}
            <aside className="sticky top-6">
              <Card className="p-5 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Vista previa
                </p>

                <div className="flex flex-col items-center py-3 gap-2.5">
                  <div className="h-14 w-14 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/35 flex items-center justify-center">
                    <MapPin
                      size={24}
                      className="text-[hsl(var(--muted-foreground))]"
                    />
                  </div>
                  <div className="text-center space-y-0.5 min-w-0">
                    {form.city ? (
                      <p className="text-base font-semibold text-[hsl(var(--foreground))] truncate">
                        {form.city}
                      </p>
                    ) : (
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        Ciudad no configurada
                      </p>
                    )}
                    {locationLine && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {locationLine}
                      </p>
                    )}
                  </div>
                  {form.colony && (
                    <div className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/45 px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--foreground))]">
                      Colonia: {form.colony}
                    </div>
                  )}
                </div>

                {(form.street || form.postalCode || form.colony) && (
                  <>
                    <div className="border-t border-[hsl(var(--border))]" />
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                        Resumen fiscal
                      </p>
                      <div className="space-y-1.5 text-xs">
                        {form.colony && (
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-[hsl(var(--muted-foreground))]">
                              Colonia
                            </span>
                            <span className="font-medium text-[hsl(var(--foreground))] text-right">
                              {form.colony}
                            </span>
                          </div>
                        )}
                        {streetLine && (
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-[hsl(var(--muted-foreground))]">
                              Calle
                            </span>
                            <span className="font-medium text-[hsl(var(--foreground))] text-right">
                              {streetLine}
                            </span>
                          </div>
                        )}
                        {interiorLine && (
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-[hsl(var(--muted-foreground))]">
                              Interior
                            </span>
                            <span className="font-medium text-[hsl(var(--foreground))] text-right">
                              {interiorLine}
                            </span>
                          </div>
                        )}
                        {form.postalCode && (
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-[hsl(var(--muted-foreground))]">
                              Codigo postal
                            </span>
                            <span className="font-medium text-[hsl(var(--foreground))] text-right">
                              {form.postalCode}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </Card>
            </aside>
          </form>
        </div>
      </div>
    </div>
  );
}
