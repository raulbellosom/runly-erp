import { ListPager, usePagedList as usePagedListBase } from '@runly/ui'

export const CATALOG_PAGE_SIZE = 10

// Catalog lists page 10 at a time; the pager itself lives in @runly/ui.
export function usePagedList(items, pageSize = CATALOG_PAGE_SIZE) {
  return usePagedListBase(items, pageSize)
}

export const CatalogPager = ListPager
