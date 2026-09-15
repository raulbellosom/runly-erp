import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  ComboboxField,
  DateField,
  DistDropZone,
  MarkdownField,
  PageHeader,
  PasswordField,
  PhoneField,
  SelectField,
  Skeleton,
  TextField,
} from "@runly/ui";
import { AdvancedFileViewer } from "@runly/ui";
import { Country, State, City } from "country-state-city";
import {
  CalendarDays,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  User,
  VenusAndMars,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthProvider";
import { runly } from "../lib/runly";

function toDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: birthDate is a calendar date (@db.Date, stored at UTC midnight)
  return date.toISOString().slice(0, 10);
}

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  birthDate: "",
  gender: "",
  phone: "",
  country: "",
  state: "",
  city: "",
  colony: "",
  street: "",
  extNumber: "",
  intNumber: "",
  postalCode: "",
  bio: "",
};

export function ProfileScreen() {
  const { session, refreshProfile } = useAuth();
  const token = session?.access_token;
  const initialFormRef = useRef(EMPTY_FORM);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["profile-me"],
    queryFn: () => runly.profile.me(token),
    enabled: Boolean(token),
  });

  const resolveAvatarSignedUrl = useCallback(
    async () => {
      const res = await runly.profile.getAvatarSignedUrl(token, { variant: "full" });
      return res?.data?.signedUrl ?? null;
    },
    [token],
  );

  const [form, setForm] = useState(EMPTY_FORM);

  const countryOptions = useMemo(
    () => Country.getAllCountries().map((c) => ({ value: c.isoCode, label: c.name })),
    []
  );

  const stateOptions = useMemo(
    () =>
      form.country
        ? State.getStatesOfCountry(form.country).map((s) => ({ value: s.isoCode, label: s.name }))
        : [],
    [form.country]
  );

  const cityOptions = useMemo(
    () =>
      form.country && form.state
        ? City.getCitiesOfState(form.country, form.state).map((c) => ({ value: c.name, label: c.name }))
        : [],
    [form.country, form.state]
  );

  function handleCountryChange(val) {
    setForm((f) => ({ ...f, country: val, state: "", city: "", colony: "" }));
  }

  function handleStateChange(val) {
    setForm((f) => ({ ...f, state: val, city: "", colony: "" }));
  }

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    const data = profileQuery.data?.data;
    if (!data) return;
    const loaded = {
      firstName: data.firstName ?? "",
      lastName: data.lastName ?? "",
      birthDate: toDateInputValue(data.birthDate),
      gender: data.gender ?? "",
      phone: data.phone ?? "",
      country: data.country ?? "",
      state: data.state ?? "",
      city: data.city ?? "",
      colony: data.colony ?? "",
      street: data.street ?? "",
      extNumber: data.extNumber ?? "",
      intNumber: data.intNumber ?? "",
      postalCode: data.postalCode ?? "",
      bio: data.bio ?? "",
    };
    initialFormRef.current = loaded;
    setForm(loaded);
  }, [profileQuery.data]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);

  const saveMutation = useMutation({
    mutationFn: () => runly.profile.updateMe(form, token),
    onSuccess: () => {
      profileQuery.refetch();
      refreshProfile(session);
      toast.success("Perfil actualizado", {
        description: "Tu información personal se guardó correctamente.",
      });
    },
    onError: () => {
      toast.error("No se pudo guardar", {
        description: "Ocurrió un error al actualizar tu perfil. Inténtalo de nuevo.",
      });
    },
  });

  const avatarMutation = useMutation({
    mutationFn: (file) => runly.profile.uploadAvatar(file, token),
    onSuccess: () => {
      profileQuery.refetch();
      refreshProfile(session);
    },
  });

  function handleAvatarFile(file) {
    if (!file) return;
    toast.promise(
      new Promise((resolve, reject) => {
        avatarMutation.mutate(file, {
          onSuccess: resolve,
          onError: reject,
        });
      }),
      {
        loading: "Subiendo foto de perfil...",
        success: "Foto de perfil actualizada.",
        error: "No se pudo subir la foto. Inténtalo de nuevo.",
      }
    );
  }

  const passwordMutation = useMutation({
    mutationFn: () => runly.profile.changePassword(passwordForm, token),
    onSuccess: () => {
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Contraseña actualizada", {
        description: "Tu contraseña se cambió correctamente.",
      });
    },
    onError: (err) => {
      const msg = err?.response?.data?.error ?? "Verifica tu contraseña actual e inténtalo de nuevo.";
      toast.error("No se pudo actualizar la contraseña", { description: msg });
    },
  });

  const profile = profileQuery.data?.data;
  const avatarFallback = `${form.firstName?.[0] ?? ""}${form.lastName?.[0] ?? ""}`
    .trim()
    .toUpperCase() || "U";

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-4xl mx-auto w-full">
        <PageHeader
          eyebrow="Cuenta"
          title="Mi perfil"
          description="Gestiona tu información personal y preferencias de cuenta."
        />

        {/* Personal info card */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40">
            <p className="text-sm font-semibold">Datos personales</p>
          </div>
          <div className="p-4 space-y-5">
            {profileQuery.isLoading ? (
              <>
                <div className="flex items-center gap-4">
                  <Skeleton className="h-20 w-20 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-10 w-36 rounded-lg" />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-11 w-full rounded-lg" />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Skeleton className="h-10 w-36 rounded-xl" />
                </div>
              </>
            ) : (
              <>
                {/* Avatar */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-[hsl(var(--border))] p-4">
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      aria-label="Ver foto de perfil"
                      disabled={!profile?.avatarFileId || avatarMutation.isPending}
                      onClick={() => profile?.avatarFileId && setImageViewerOpen(true)}
                      className="relative block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none"
                    >
                      <Avatar className="h-20 w-20">
                        <AvatarImage src={profile?.avatarUrl ?? ""} alt="Avatar" />
                        <AvatarFallback className="text-lg font-semibold">{avatarFallback}</AvatarFallback>
                      </Avatar>
                      {avatarMutation.isPending ? (
                        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                          <span className="text-[10px] text-white font-medium">Subiendo</span>
                        </div>
                      ) : profile?.avatarUrl ? (
                        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 hover:bg-black/30 transition-colors duration-150 group">
                          <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
                        </div>
                      ) : null}
                    </button>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-sm font-medium">{profile?.displayName ?? form.firstName}</p>
                    <DistDropZone
                      variant="compact"
                      accept="image/*"
                      maxSizeMB={10}
                      fullScreenOverlay
                      overlayLabel="Suelta tu foto aqui"
                      overlayHint="JPG, PNG o WebP · maximo 10 MB"
                      onFile={handleAvatarFile}
                      isUploading={avatarMutation.isPending}
                      emptyLabel="Arrastra o haz clic para cambiar foto"
                      emptyHint="JPG, PNG o WebP · maximo 10 MB"
                    />
                  </div>
                </div>

                {/* Personal fields */}
                <div className="grid md:grid-cols-2 gap-4">
                  <TextField
                    label="Nombre"
                    icon={User}
                    value={form.firstName}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  />
                  <TextField
                    label="Apellidos"
                    icon={User}
                    value={form.lastName}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  />
                  <TextField
                    label="Correo electrónico"
                    icon={Mail}
                    value={profile?.email ?? ""}
                    disabled
                  />
                  <DateField
                    label="Fecha de nacimiento"
                    icon={CalendarDays}
                    value={form.birthDate}
                    onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))}
                  />
                  <SelectField
                    label="Sexo"
                    icon={VenusAndMars}
                    value={form.gender}
                    placeholder="Seleccionar"
                    options={[
                      { value: "masculino", label: "Masculino" },
                      { value: "femenino", label: "Femenino" },
                      { value: "no_binario", label: "No binario" },
                      { value: "prefiero_no_decir", label: "Prefiero no decir" },
                    ]}
                    onValueChange={(value) => setForm((f) => ({ ...f, gender: value }))}
                  />
                  <PhoneField
                    label="Teléfono"
                    icon={Phone}
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>

                <MarkdownField
                  label="Biografía"
                  value={form.bio}
                  maxLength={500}
                  placeholder="Escribe tu biografía aquí..."
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                />

                {/* Address */}
                <div>
                  <p className="text-[13px] font-medium text-[hsl(var(--foreground))]/80 mb-3 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                    Dirección
                  </p>
                  <div className="grid md:grid-cols-2 gap-4">
                    <ComboboxField
                      label="País"
                      options={countryOptions}
                      value={form.country}
                      onChange={handleCountryChange}
                      placeholder="Seleccionar país..."
                      searchPlaceholder="Buscar país..."
                    />
                    {stateOptions.length > 0 ? (
                      <ComboboxField
                        label="Estado / Provincia"
                        options={stateOptions}
                        value={form.state}
                        onChange={handleStateChange}
                        placeholder="Seleccionar estado..."
                        searchPlaceholder="Buscar estado..."
                      />
                    ) : (
                      <TextField
                        label="Estado / Provincia"
                        icon={MapPin}
                        value={form.state}
                        onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                      />
                    )}
                    {form.country && cityOptions.length > 0 ? (
                      <ComboboxField
                        label="Ciudad / Municipio"
                        options={cityOptions}
                        value={form.city}
                        onChange={(val) => setForm((f) => ({ ...f, city: val }))}
                        placeholder="Seleccionar ciudad..."
                        searchPlaceholder="Buscar ciudad..."
                        minSearchLength={2}
                      />
                    ) : (
                      <TextField
                        label="Ciudad / Municipio"
                        icon={MapPin}
                        value={form.city}
                        onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                      />
                    )}
                    <TextField
                      label="Colonia / Fraccionamiento"
                      icon={MapPin}
                      value={form.colony}
                      onChange={(e) => setForm((f) => ({ ...f, colony: e.target.value }))}
                    />
                    <TextField
                      label="Calle"
                      icon={MapPin}
                      value={form.street}
                      onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
                    />
                    <TextField
                      label="Número exterior"
                      value={form.extNumber}
                      onChange={(e) => setForm((f) => ({ ...f, extNumber: e.target.value }))}
                    />
                    <TextField
                      label="Número interior"
                      value={form.intNumber}
                      onChange={(e) => setForm((f) => ({ ...f, intNumber: e.target.value }))}
                    />
                    <TextField
                      label="Código postal"
                      value={form.postalCode}
                      onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-[hsl(var(--border))]">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || !isDirty || !form.firstName || !form.lastName}
                  >
                    {saveMutation.isPending ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Password card */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40">
            <p className="text-sm font-semibold">Cambiar contraseña</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <PasswordField
                label="Contraseña actual"
                icon={LockKeyhole}
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
              />
              <PasswordField
                label="Nueva contraseña"
                icon={LockKeyhole}
                showStrength
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
              />
              <PasswordField
                label="Confirmar nueva"
                icon={LockKeyhole}
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              />
            </div>
            <div className="flex justify-end pt-2 border-t border-[hsl(var(--border))]">
              <Button
                onClick={() => passwordMutation.mutate()}
                disabled={
                  passwordMutation.isPending ||
                  !passwordForm.currentPassword ||
                  !passwordForm.newPassword ||
                  !passwordForm.confirmPassword
                }
              >
                {passwordMutation.isPending ? "Actualizando..." : "Actualizar contraseña"}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {profile?.avatarFileId && (
        <AdvancedFileViewer
          open={imageViewerOpen}
          onOpenChange={setImageViewerOpen}
          files={[
            {
              id: profile.avatarFileId,
              mimeType: "image/jpeg",
              originalName: profile.displayName ?? "Foto de perfil",
              sizeBytes: 0,
            },
          ]}
          activeIndex={0}
          onIndexChange={() => {}}
          onResolveSignedUrl={resolveAvatarSignedUrl}
        />
      )}
    </div>
  );
}
