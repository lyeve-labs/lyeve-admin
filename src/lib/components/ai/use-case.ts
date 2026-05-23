/** The words a use case is shown under. The key stays visible beside it. */
export function useCaseLabel(useCase: string): string {
	const known: Record<string, string> = {
		default: 'Default',
		assistant: 'Editor assistant',
		flow_assistant: 'Flow assistant',
		translate: 'Translate',
		summarize: 'Summarize',
		suggest: 'Search suggestions',
		alt_text: 'Alt text',
		classify: 'Classify',
		extract: 'Extract',
		recap: 'Transcript recap',
	};
	return known[useCase] ?? useCase.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
