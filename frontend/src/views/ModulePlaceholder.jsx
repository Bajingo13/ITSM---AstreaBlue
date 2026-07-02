import PageHero from "../components/layout/PageHero";
export default function ModulePlaceholder({ title, description }) {
  return (
    <div className="space-y-6">
      <PageHero eyebrow="AstreaBlue ITSM" title={title} subtitle={description || "Access the connected controls and operational workspace for this module."} compact />

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
