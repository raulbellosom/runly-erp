import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'

function loadingMutation(msg) {
  return {
    onMutate: () => ({ toastId: toast.loading(msg) }),
    onSuccess: (_, __, ctx) => toast.dismiss(ctx?.toastId),
    onError:   (_, __, ctx) => toast.dismiss(ctx?.toastId),
  }
}

function useToken() {
  const { session } = useAuth()
  return session?.access_token
}

// ── Categories ────────────────────────────────────────────────────────────────

export function useInventoryCategories() {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn: () => runly.inventory.listCategories(token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateInventoryCategory() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.inventory.createCategory(data, token),
    ...loadingMutation('Creando categoria...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'categories'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'models'] })
    },
  })
}

export function useUpdateInventoryCategory() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }) => runly.inventory.updateCategory(id, data, token),
    ...loadingMutation('Guardando categoria...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'categories'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'models'] })
    },
  })
}

export function useDeleteInventoryCategory() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => runly.inventory.deleteCategory(id, token),
    ...loadingMutation('Eliminando categoria...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'categories'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'models'] })
    },
  })
}

export function useReorderInventoryCategories() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items) => runly.inventory.reorderCategories(items, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'categories'] }),
    onError: () => toast.error('Error al guardar el orden'),
  })
}

// ── Brands ────────────────────────────────────────────────────────────────────

export function useInventoryBrands() {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'brands'],
    queryFn: () => runly.inventory.listBrands(token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateInventoryBrand() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.inventory.createBrand(data, token),
    ...loadingMutation('Creando marca...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'brands'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'models'] })
    },
  })
}

export function useUpdateInventoryBrand() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }) => runly.inventory.updateBrand(id, data, token),
    ...loadingMutation('Guardando marca...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'brands'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'models'] })
    },
  })
}

export function useDeleteInventoryBrand() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => runly.inventory.deleteBrand(id, token),
    ...loadingMutation('Eliminando marca...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'brands'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'models'] })
    },
  })
}

export function useReorderInventoryBrands() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items) => runly.inventory.reorderBrands(items, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'brands'] }),
    onError: () => toast.error('Error al guardar el orden'),
  })
}

// ── Locations ─────────────────────────────────────────────────────────────────

export function useInventoryLocations() {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'locations'],
    queryFn: () => runly.inventory.listLocations(token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateInventoryLocation() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.inventory.createLocation(data, token),
    ...loadingMutation('Creando ubicacion...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'locations'] })
    },
  })
}

export function useUpdateInventoryLocation() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }) => runly.inventory.updateLocation(id, data, token),
    ...loadingMutation('Guardando ubicacion...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'locations'] })
    },
  })
}

export function useDeleteInventoryLocation() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => runly.inventory.deleteLocation(id, token),
    ...loadingMutation('Eliminando ubicacion...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'locations'] })
    },
  })
}

export function useReorderInventoryLocations() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items) => runly.inventory.reorderLocations(items, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'locations'] }),
    onError: () => toast.error('Error al guardar el orden'),
  })
}

// ── Custom fields ─────────────────────────────────────────────────────────────

export function useInventoryCustomFields(categoryId) {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'custom-fields', categoryId ?? 'global'],
    queryFn: () => runly.inventory.listCustomFields({ categoryId }, token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateInventoryCustomField() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.inventory.createCustomField(data, token),
    ...loadingMutation('Creando campo personalizado...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'custom-fields'] })
    },
  })
}

export function useUpdateInventoryCustomField() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }) => runly.inventory.updateCustomField(id, data, token),
    ...loadingMutation('Guardando campo personalizado...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'custom-fields'] })
    },
  })
}

export function useDeleteInventoryCustomField() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => runly.inventory.deleteCustomField(id, token),
    ...loadingMutation('Eliminando campo personalizado...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['inventory', 'custom-fields'] })
    },
  })
}

export function useReorderInventoryCustomFields() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items) => runly.inventory.reorderCustomFields(items, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'custom-fields'] }),
    onError: () => toast.error('Error al guardar el orden'),
  })
}
