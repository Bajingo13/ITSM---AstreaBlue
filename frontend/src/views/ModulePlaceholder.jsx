export default function ModulePlaceholder({ title, description }) {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <h1 className="text-3xl font-black">{title}</h1>
        <p className="mt-2 text-blue-100">
          {description || "This AstreaBlue ITSM module is ready for implementation."}
        </p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">Module Workspace</h2>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          Core navigation is connected. Build the workflow, tables, forms, and
          dashboards for this module here.
        </p>
      </section>
    </div>
  );
}
