import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdownMenu";
import { buildCSV, downloadCSV } from "@/lib/utils/csv";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { type DashboardData, getCSVSections } from "../utils/exportUtils";

const PDF_TAB_LABELS = [
	"Overview",
	"Provider Usage",
	"Model Rankings",
	"MCP Usage",
	"Team Rankings",
	"Customer Rankings",
	"Business Unit Rankings",
	"User Rankings",
	"Virtual Key Rankings",
];

interface ExportPopoverProps {
	getData: () => DashboardData;
	onPreloadData: () => Promise<void>;
	onPdfExport: () => Promise<HTMLElement[]>;
	onPdfExportDone: () => void;
}

export function ExportPopover({ getData, onPreloadData, onPdfExport, onPdfExportDone }: ExportPopoverProps) {
	const [exporting, setExporting] = useState(false);
	const [open, setOpen] = useState(false);

	const handleCsvExport = useCallback(async () => {
		setExporting(true);
		try {
			await onPreloadData();
			const sections = getCSVSections(getData(), "all");
			const parts: string[] = [];
			for (const section of sections) {
				if (section.csv.rows.length === 0) continue;
				parts.push(`# ${section.name}`);
				parts.push(buildCSV(section.csv.headers, section.csv.rows));
				parts.push("");
			}
			if (parts.length > 0) {
				downloadCSV(parts.join("\n"), "dashboard-export");
			}
		} finally {
			setExporting(false);
		}
	}, [getData, onPreloadData]);

	const handlePdfExport = useCallback(async () => {
		setExporting(true);

		// Yield a frame so the spinner renders before heavy work starts
		await new Promise((r) => requestAnimationFrame(r));

		try {
			const { generatePdf } = await import("@/lib/utils/pdf");

			const elements = await onPdfExport();

			const sections = elements.map((element, i) => ({
				element,
				label: PDF_TAB_LABELS[i],
			}));

			await generatePdf(sections, "dashboard-export", {
				branding: {
					logoSrc: "/elygate-logo.svg",
					text: "Elygate",
				},
			});
		} finally {
			onPdfExportDone();
			setExporting(false);
		}
	}, [onPdfExport, onPdfExportDone]);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="default" disabled={exporting} data-testid="dashboard-export-trigger">
					{exporting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
					{exporting ? "Exporting..." : "Export"}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					<DropdownMenuItem
						onSelect={() => {
							setOpen(false);
							void handleCsvExport();
						}}
						data-testid="export-csv-item"
					>
						<FileSpreadsheet data-icon="inline-start" />
						CSV
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							setOpen(false);
							void handlePdfExport();
						}}
						data-testid="export-pdf-item"
					>
						<FileText data-icon="inline-start" />
						PDF
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
