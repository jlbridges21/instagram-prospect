import Link from "next/link";
import {
  FIT_LABELS,
  FIT_LABELS_TEXT,
  PROSPECT_STATUSES,
  SORT_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/constants/prospects";
import type { ProspectQuery, ProspectView } from "@/lib/db/prospects";
import { prospectSearchString } from "@/lib/utils/prospect-search";
import { SelectInput, TextInput } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";

export function ProspectFilters({
  query,
  categories,
}: {
  query: ProspectQuery;
  categories: string[];
}) {
  const views: { id: ProspectView; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "review", label: "Review" },
    { id: "approved", label: "Approved" },
    { id: "contacted", label: "Contacted" },
    { id: "excluded", label: "Excluded" },
    { id: "all", label: "All" },
  ];

  return (
    <div className="mb-4">
      <div className="mb-3 flex gap-2 overflow-x-auto">
        {views.map((view) => (
          <Link
            key={view.id}
            href={`/prospects${prospectSearchString({ ...query, view: view.id, page: 1 })}`}
            className={
              query.view === view.id
                ? "rounded-full bg-indigo-600 px-3 py-1 text-sm font-medium text-white"
                : "rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-600 ring-1 ring-slate-200"
            }
          >
            {view.label}
          </Link>
        ))}
      </div>
    <form
      method="get"
      className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-4"
    >
      {query.view !== "active" ? <input type="hidden" name="view" value={query.view} /> : null}
      <label className="block md:col-span-2 xl:col-span-2">
        <span className="text-xs font-medium text-slate-500">Search</span>
        <TextInput
          name="q"
          defaultValue={query.q}
          placeholder="Name, username, or category"
          className="mt-1.5"
        />
      </label>
      <FilterSelect label="Status" name="status" defaultValue={query.status}>
        <option value="all">All statuses</option>
        {PROSPECT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect label="Fit" name="fit" defaultValue={query.fit}>
        <option value="all">All fits</option>
        {FIT_LABELS.map((fit) => (
          <option key={fit} value={fit}>
            {FIT_LABELS_TEXT[fit]}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect label="Category" name="category" defaultValue={query.category}>
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect label="Source" name="source" defaultValue={query.source}>
        <option value="">All sources</option>
        {Object.entries(SOURCE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </FilterSelect>
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Min followers</span>
        <TextInput
          name="min"
          inputMode="numeric"
          defaultValue={query.minFollowers}
          className="mt-1.5"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Max followers</span>
        <TextInput
          name="max"
          inputMode="numeric"
          defaultValue={query.maxFollowers}
          className="mt-1.5"
        />
      </label>
      <FilterSelect label="Sort" name="sort" defaultValue={query.sort}>
        {Object.entries(SORT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </FilterSelect>
      <div className="flex items-end gap-2 md:col-span-2 xl:col-span-3">
        <button type="submit" className={buttonClasses("primary", "md")}>
          Apply
        </button>
        <Link href="/prospects" className={buttonClasses("secondary", "md")}>
          Clear filters
        </Link>
      </div>
    </form>
    </div>
  );
}

function FilterSelect({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <SelectInput {...props} className="mt-1.5">
        {children}
      </SelectInput>
    </label>
  );
}

export function ProspectPagination({
  query,
  page,
  pageCount,
}: {
  query: ProspectQuery;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <p>
        Page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={`/prospects${prospectSearchString(query, page - 1)}`} className={buttonClasses("secondary", "sm")}>
            Previous
          </Link>
        ) : (
          <span className={`${buttonClasses("secondary", "sm")} opacity-50`}>Previous</span>
        )}
        {page < pageCount ? (
          <Link href={`/prospects${prospectSearchString(query, page + 1)}`} className={buttonClasses("secondary", "sm")}>
            Next
          </Link>
        ) : (
          <span className={`${buttonClasses("secondary", "sm")} opacity-50`}>Next</span>
        )}
      </div>
    </div>
  );
}
