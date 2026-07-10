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
import { useCallback, useRef, useState } from "react";
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
	const [menuCycle, setMenuCycle] = useState(0);
	const exportingRef = useRef(false);

	const runExport = useCallback(async (exportAction: () => Promise<void>) => {
		if (exportingRef.current) return;

		exportingRef.current = true;
		setExporting(true);
		try {
			await exportAction();
		} finally {
			exportingRef.current = false;
			setExporting(false);
			// Radix can retain a completed selection cycle long enough to swallow an
			// immediate second open. Remount the menu after each export so the next
			// CSV/PDF action always starts from a clean interaction state.
			setMenuCycle((cycle) => cycle + 1);
		}
	}, []);

	const handleCsvExport = useCallback(async () => {
		await runExport(async () => {
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
		});
	}, [getData, onPreloadData, runExport]);

	const handlePdfExport = useCallback(async () => {
		await runExport(async () => {
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
			}
		});
	}, [onPdfExport, onPdfExportDone, runExport]);

	return (
		<DropdownMenu key={menuCycle}>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="default" aria-busy={exporting} data-testid="dashboard-export-trigger">
					{exporting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
					{exporting ? "Exporting..." : "Export"}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					<DropdownMenuItem
						onSelect={() => {
							void handleCsvExport();
						}}
						disabled={exporting}
						data-testid="export-csv-item"
					>
						<FileSpreadsheet data-icon="inline-start" />
						CSV
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							void handlePdfExport();
						}}
						disabled={exporting}
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
