import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowUp, ArrowDown, ChevronsUpDown, FileSearch } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table.jsx'
import { Button } from './Button.jsx'
import { Skeleton } from './Skeleton.jsx'
import { SearchInput } from './SearchInput.jsx'
import { FilterBar } from './FilterBar.jsx'
import { EmptyState } from './EmptyState.jsx'
import { ErrorState } from './ErrorState.jsx'
import { PageFooter } from './PageFooter.jsx'
import { cn } from '../lib/utils.js'

export function DataTable({
  columns,
  data,
  searchPlaceholder = 'Buscar...',
  pageSize: initialPageSize = 10,
  filters,
  isLoading,
  isError,
  onRetry,
  emptyTitle = 'Sin resultados',
  emptyDescription,
  emptyIcon,
  emptyAction,
  className,
  manualPagination = false,
  getRowId,
  autoResetPageIndex,
  showToolbar = true,
  showPagination = true,
}) {
  const EMPTY_ROWS = useMemo(() => [], [])
  const [sorting, setSorting] = useState([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [filterValues, setFilterValues] = useState({})
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: initialPageSize })

  const filteredData = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return EMPTY_ROWS
    if (!filters?.length) return data
    return data.filter((row) =>
      filters.every((filter) => {
        const active = filterValues[filter.key]
        if (!active) return true
        return filter.match
          ? filter.match(row, active)
          : String(row[filter.key]) === active
      }),
    )
  }, [data, filters, filterValues, EMPTY_ROWS])

  const table = useReactTable({
    data: filteredData,
    getRowId,
    autoResetPageIndex,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination,
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
  })

  const rows = table.getRowModel().rows

  return (
    <div className={cn('flex flex-col gap-0', className)}>
      {showToolbar && (columns.length > 0 || filters) && (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <SearchInput
            value={globalFilter}
            onChange={(e) => {
              setGlobalFilter(e.target.value)
              setPagination((p) => ({ ...p, pageIndex: 0 }))
            }}
            placeholder={searchPlaceholder}
            className="w-full sm:max-w-xs"
          />
          {filters && (
            <FilterBar
              filters={filters}
              value={filterValues}
              onChange={(next) => {
                setFilterValues(next)
                setPagination((p) => ({ ...p, pageIndex: 0 }))
              }}
            />
          )}
        </div>
      )}

      <div className="rounded-2xl glass overflow-clip">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex cursor-pointer items-center gap-1 hover:text-[hsl(var(--foreground))] transition-colors"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-(--brand-primary)" />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown className="h-3.5 w-3.5 text-(--brand-primary)" />
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-30" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: pagination.pageSize }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-0">
                  <ErrorState
                    title="Error al cargar los datos"
                    description="No se pudieron obtener los registros."
                    onRetry={onRetry}
                    className="border-0 rounded-none"
                  />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-0">
                  <EmptyState
                    icon={emptyIcon ?? FileSearch}
                    title={emptyTitle}
                    description={emptyDescription}
                    action={emptyAction}
                    className="border-0 rounded-none"
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {showPagination && <PageFooter
        total={table.getFilteredRowModel().rows.length}
        pageIndex={table.getState().pagination.pageIndex}
        pageCount={table.getPageCount()}
        pageSize={table.getState().pagination.pageSize}
        canPrevious={table.getCanPreviousPage()}
        canNext={table.getCanNextPage()}
        onPrevious={() => table.previousPage()}
        onNext={() => table.nextPage()}
        onPageSizeChange={(size) => {
          table.setPageSize(size)
          setPagination((p) => ({ ...p, pageIndex: 0, pageSize: size }))
        }}
      />}
    </div>
  )
}
