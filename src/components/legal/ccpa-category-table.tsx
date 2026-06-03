import { DATA_CATEGORIES, type DataCategory } from "@/lib/legal/constants";

export function CcpaCategoryTable({
  items,
}: {
  items?: readonly DataCategory[];
}) {
  const categories = items ?? DATA_CATEGORIES;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 pr-4 font-medium text-foreground/90">
              Data Category
            </th>
            <th className="pb-2 font-medium text-foreground/90">
              CCPA Category (§ 1798.140)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {categories.map((cat) => (
            <tr key={cat.id}>
              <td className="py-2 pr-4 text-foreground/80">{cat.label}</td>
              <td className="py-2 text-muted-foreground">{cat.ccpaCategory}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
