import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdvancedFileViewer, Button, Card, DistDropZone, ErrorState, PageHeader, Skeleton } from "@runly/ui";
import { Palette, Upload, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { applyBrandTheme } from "../../../lib/brandTheme";
import { useBrandingStore } from "../../../stores/branding.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const FIVE_MB = 5 * 1024 * 1024;

const PRESET_COLORS = [
  "#0A7BFF",
  "#6C3BFF",
  "#A80070",
  "#E8330A",
  "#F59E0B",
  "#10B981",
  "#0EA5E9",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#F97316",
  "#064E3B",
];

function formatBytes(bytes) {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ─── Color extraction helpers ─────────────────────────────────────────────────

function extractColorsFromImageEl(img, count = 6) {
  try {
    const canvas = document.createElement("canvas");
    const SIZE = 64;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const freq = {};
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const brightness = (r + g + b) / 3;
      if (brightness > 238 || brightness < 18) continue;
      const qr = Math.round(r / 28) * 28;
      const qg = Math.round(g / 28) * 28;
      const qb = Math.round(b / 28) * 28;
      const key = `${qr},${qg},${qb}`;
      freq[key] = (freq[key] || 0) + 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const picked = [];
    for (const [key] of sorted) {
      const [r, g, b] = key.split(",").map(Number);
      const hex =
        "#" +
        [r, g, b]
          .map((v) => Math.min(255, v).toString(16).padStart(2, "0"))
          .join("");
      const tooClose = picked.some((p) => {
        const pr = parseInt(p.slice(1, 3), 16);
        const pg = parseInt(p.slice(3, 5), 16);
        const pb = parseInt(p.slice(5, 7), 16);
        return Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) < 55;
      });
      if (!tooClose) {
        picked.push(hex);
        if (picked.length >= count) break;
      }
    }
    return picked;
  } catch {
    return [];
  }
}

function extractColorsFromFile(file, count = 6) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const colors = extractColorsFromImageEl(img, count);
      URL.revokeObjectURL(url);
      resolve(colors);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve([]);
    };
    img.src = url;
  });
}

function extractColorsFromUrl(url, count = 6) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(extractColorsFromImageEl(img, count));
    img.onerror = () => resolve([]);
    img.src = url;
  });
}

// ─── LogoZone sub-component ───────────────────────────────────────────────────

function LogoZone({
  logoPreviewUrl,
  logoFile,
  currentLogoUrl,
  uploading,
  disabled,
  onFile,
  onRemove,
  onViewCurrent,
}) {
  const [sizeError, setSizeError] = useState("");
  const inputRef = useRef(null);

  const handleFile = useCallback(
    (file) => {
      setSizeError("");
      if (!file) return;
      if (file.size > FIVE_MB) {
        setSizeError(
          `Archivo demasiado grande. Maximo ${formatBytes(FIVE_MB)}`,
        );
        return;
      }
      onFile(file);
    },
    [onFile],
  );

  const displayUrl = logoPreviewUrl ?? currentLogoUrl;
  const hasLogo = Boolean(displayUrl);

  if (hasLogo) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={onViewCurrent}
            disabled={!currentLogoUrl && !logoPreviewUrl}
            className="group relative w-24 h-24 rounded-xl border border-[hsl(var(--border))] bg-white flex items-center justify-center overflow-hidden shrink-0 hover:ring-2 hover:ring-[hsl(var(--ring))] transition-all duration-150 disabled:cursor-default"
            aria-label="Ver logo en pantalla completa"
          >
            <img
              src={displayUrl}
              alt="Logotipo de la empresa"
              className="max-w-full max-h-full object-contain"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-150 flex items-center justify-center">
              <ZoomIn
                className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 drop-shadow"
                size={18}
              />
            </div>
          </button>

          <div className="flex-1 min-w-0 space-y-2">
            {logoFile ? (
              <>
                <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                  {logoFile.name}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {formatBytes(logoFile.size)}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                  Logo actual
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Clic en la imagen para ampliar
                </p>
              </>
            )}
            {!disabled && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => !uploading && inputRef.current?.click()}
                  disabled={uploading}
                  className="text-xs font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50 disabled:cursor-default"
                >
                  {uploading ? "Subiendo..." : "Cambiar logo"}
                </button>
                <span className="text-[hsl(var(--muted-foreground))]">·</span>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={uploading}
                  className="text-xs font-medium text-[hsl(var(--destructive))] hover:underline disabled:opacity-50 disabled:cursor-default"
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        {sizeError && (
          <p className="text-xs text-[hsl(var(--destructive))]">{sizeError}</p>
        )}
      </div>
    );
  }

  return (
    <DistDropZone
      accept="image/*"
      maxSizeMB={5}
      isUploading={disabled}
      fullScreenOverlay={!disabled}
      overlayLabel="Suelta tu logotipo aqui"
      overlayHint={`PNG, JPG o WebP · max 5 MB`}
      onFile={onFile}
      emptyLabel="Arrastra tu logotipo aqui"
      emptyHint={`PNG, JPG o WebP · Maximo ${formatBytes(FIVE_MB)}`}
    />
  );
}

// ─── ColorPicker sub-component ────────────────────────────────────────────────

function ColorPicker({ value, onChange, suggestedColors, disabled }) {
  const isFromLogo = suggestedColors !== PRESET_COLORS;

  return (
    <div className="space-y-3">
      <label className="text-[13px] font-medium leading-none text-[hsl(var(--foreground))]/80 flex items-center gap-1.5">
        <Palette className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
        Color principal
      </label>

      <div className="flex items-center gap-3">
        <div
          className="relative w-11 h-11 rounded-lg overflow-hidden border border-[hsl(var(--border))] shrink-0"
          style={{ background: value }}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => !disabled && onChange(e.target.value)}
            disabled={disabled}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
            aria-label="Seleccionar color personalizado"
          />
        </div>
        <div>
          <p className="font-mono text-sm text-[hsl(var(--foreground))]">
            {value.toUpperCase()}
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            Clic para personalizar
          </p>
        </div>
      </div>

      {suggestedColors.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
            <Palette size={10} />
            {isFromLogo
              ? "Colores extraidos del logotipo"
              : "Colores predefinidos"}
          </p>
          <div className="flex gap-2 flex-wrap">
            {suggestedColors.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => !disabled && onChange(color)}
                disabled={disabled}
                aria-label={`Usar color ${color}`}
                className={[
                  "w-7 h-7 rounded-lg border-2 transition-all duration-150",
                  "hover:scale-110 active:scale-95 disabled:cursor-default disabled:hover:scale-100",
                  value === color
                    ? "border-[hsl(var(--foreground))] ring-2 ring-[hsl(var(--foreground))]/20 scale-110"
                    : "border-[hsl(var(--border))] hover:border-[hsl(var(--foreground))]/40",
                ].join(" ")}
                style={{ background: color }}
              />
            ))}
          </div>
        </div>
      )}

      {isFromLogo && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
            <Palette size={10} />
            Colores predefinidos
          </p>
          <div className="flex gap-2 flex-wrap">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => !disabled && onChange(color)}
                disabled={disabled}
                aria-label={`Usar color ${color}`}
                className={[
                  "w-7 h-7 rounded-lg border-2 transition-all duration-150",
                  "hover:scale-110 active:scale-95 disabled:cursor-default disabled:hover:scale-100",
                  value === color
                    ? "border-[hsl(var(--foreground))] ring-2 ring-[hsl(var(--foreground))]/20 scale-110"
                    : "border-[hsl(var(--border))] hover:border-[hsl(var(--foreground))]/40",
                ].join(" ")}
                style={{ background: color }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CompanyBranding() {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const canManage = Boolean(
    userProfile?.isAdmin ||
      userProfile?.permissions?.includes("company.branding.update"),
  );
  const queryClient = useQueryClient();
  const setBranding = useBrandingStore((s) => s.setBranding);
  const currentBranding = useBrandingStore((s) => s.branding);

  const brandingQuery = useQuery({
    queryKey: ["company-branding"],
    queryFn: () => runly.company.getBranding(token),
    enabled: Boolean(token),
  });

  const [form, setForm] = useState({
    primaryColor: "#0A7BFF",
    logoFileId: null,
  });
  const [currentLogoUrl, setCurrentLogoUrl] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [suggestedColors, setSuggestedColors] = useState(PRESET_COLORS);

  useEffect(() => {
    const data = brandingQuery.data?.data;
    if (!data) return;
    setForm({
      primaryColor: data.primaryColor ?? "#0A7BFF",
      logoFileId: data.logoFileId ?? null,
    });
    setCurrentLogoUrl(data.logoUrl ?? null);
  }, [brandingQuery.data]);

  // Extract colors from current logo URL on first load
  useEffect(() => {
    if (!currentLogoUrl || logoFile) return;
    extractColorsFromUrl(currentLogoUrl).then((colors) => {
      if (colors.length >= 3) setSuggestedColors(colors);
    });
  }, [currentLogoUrl, logoFile]);

  // Preview + color extraction when new file is selected
  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(null);
      if (!currentLogoUrl) setSuggestedColors(PRESET_COLORS);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(url);
    extractColorsFromFile(logoFile).then((colors) => {
      setSuggestedColors(colors.length >= 3 ? colors : PRESET_COLORS);
    });
    return () => URL.revokeObjectURL(url);
  }, [logoFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadLogoMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("moduleKey", "runly.company");
      formData.append("entityType", "BrandingConfig");
      const uploaded = await runly.files.upload(formData, token);
      const uploadedFile = uploaded?.data;
      const signed = uploadedFile?.id
        ? await runly.files.getSignedUrl(uploadedFile.id, token)
        : null;
      return { ...uploadedFile, signedUrl: signed?.data?.signedUrl ?? null };
    },
    onError: () => toast.error("No se pudo cargar el logo"),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      let finalLogoFileId = form.logoFileId;

      if (logoFile) {
        const asset = await uploadLogoMutation.mutateAsync(logoFile);
        finalLogoFileId = asset.id ?? null;
        const newUrl = asset.signedUrl ?? null;
        setCurrentLogoUrl(newUrl);
        setLogoFile(null);
        setLogoPreviewUrl(null);
        if (newUrl) {
          extractColorsFromUrl(newUrl).then((colors) => {
            if (colors.length >= 3) setSuggestedColors(colors);
          });
        }
      }

      return runly.company.updateBranding(
        { primaryColor: form.primaryColor, logoFileId: finalLogoFileId },
        token,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["company-branding"] });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      await queryClient.invalidateQueries({ queryKey: ["memberships-me"] });
      applyBrandTheme(form.primaryColor);
      setBranding({ ...currentBranding, primaryColor: form.primaryColor });
      toast.success("Marca visual actualizada");
    },
    onError: () => toast.error("No se pudo guardar la configuracion de marca"),
  });

  function handleLogoRemove() {
    setLogoFile(null);
    setLogoPreviewUrl(null);
    setCurrentLogoUrl(null);
    setSuggestedColors(PRESET_COLORS);
    setForm((prev) => ({ ...prev, logoFileId: null }));
  }

  const uploading = uploadLogoMutation.isPending;
  const saving = saveMutation.isPending;
  const disabled = !canManage || saving;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6">
        <div className="space-y-6">
          <PageHeader
            eyebrow="Empresa"
            title="Marca visual"
            description="Logotipo y paleta de colores de la empresa."
          />

          {!canManage && (
            <ErrorState message="Necesitas permiso company.branding.update para editar la marca visual." />
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate();
            }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* ── Logo card ───────────────────────── */}
              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-2 pb-1 border-b border-[hsl(var(--border))]">
                  <Upload
                    size={14}
                    className="text-[hsl(var(--muted-foreground))]"
                  />
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Logotipo
                  </h3>
                </div>
                {brandingQuery.isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <LogoZone
                    logoPreviewUrl={logoPreviewUrl}
                    logoFile={logoFile}
                    currentLogoUrl={currentLogoUrl}
                    uploading={uploading}
                    disabled={disabled}
                    onFile={setLogoFile}
                    onRemove={handleLogoRemove}
                    onViewCurrent={() => setViewerOpen(true)}
                  />
                )}
              </Card>

              {/* ── Color card ─────────────────────── */}
              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-2 pb-1 border-b border-[hsl(var(--border))]">
                  <Palette
                    size={14}
                    className="text-[hsl(var(--muted-foreground))]"
                  />
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Color principal
                  </h3>
                </div>
                {brandingQuery.isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <ColorPicker
                    value={form.primaryColor}
                    onChange={(color) =>
                      setForm((prev) => ({ ...prev, primaryColor: color }))
                    }
                    suggestedColors={suggestedColors}
                    disabled={disabled}
                  />
                )}
              </Card>
            </div>

            {canManage && (
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saving || brandingQuery.isLoading}
                  loading={saving}
                >
                  Guardar marca
                </Button>
              </div>
            )}
          </form>

          {/* Logo full-screen viewer */}
          {(currentLogoUrl || logoPreviewUrl) && (
            <AdvancedFileViewer
              open={viewerOpen}
              onOpenChange={setViewerOpen}
              files={[
                {
                  id: form.logoFileId ?? "pending-logo",
                  mimeType: logoFile?.type || "image/png",
                  originalName: logoFile?.name || "Logotipo de la empresa",
                  sizeBytes: logoFile?.size || 0,
                },
              ]}
              activeIndex={0}
              onIndexChange={() => {}}
              onResolveSignedUrl={() => logoPreviewUrl ?? currentLogoUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
}
