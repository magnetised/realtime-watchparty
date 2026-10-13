import type { LiveQueryState, SealedLiveQuery } from "@neon/realtime/client";
import { useLiveQuery } from "@neon/realtime-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type LiveResult<Row> = {
	rows: readonly Row[];
	status: LiveQueryState["status"];
	error?: Error;
};

export function LiveRows<Row>({
	endpoint,
	children,
	loading,
}: {
	endpoint: string;
	children: (result: LiveResult<Row>) => ReactNode;
	loading?: ReactNode;
}) {
	const [query, setQuery] = useState<SealedLiveQuery<Row>>();
	const [error, setError] = useState<Error>();

	useEffect(() => {
		let current = true;
		setQuery(undefined);
		setError(undefined);
		void api
			.seal<Row>(endpoint)
			.then((next) => {
				if (current) setQuery(next);
			})
			.catch((reason: unknown) => {
				if (current)
					setError(
						reason instanceof Error
							? reason
							: new Error(String(reason)),
					);
			});
		return () => {
			current = false;
		};
	}, [endpoint]);

	if (error) return children({ rows: [], status: "error", error });
	if (!query)
		return (
			loading ?? (
				<div className="loading-line">Connecting to Neon Realtime…</div>
			)
		);
	return (
		<SubscribedRows endpoint={endpoint} query={query}>
			{children}
		</SubscribedRows>
	);
}

function SubscribedRows<Row>({
	endpoint,
	query,
	children,
}: {
	endpoint: string;
	query: SealedLiveQuery<Row>;
	children: (result: LiveResult<Row>) => ReactNode;
}) {
	const refreshQuery = useCallback(() => api.seal<Row>(endpoint), [endpoint]);
	const { data, status, error } = useLiveQuery(query, { refreshQuery });
	return children({
		rows: data ?? [],
		status,
		...(error ? { error } : {}),
	});
}
