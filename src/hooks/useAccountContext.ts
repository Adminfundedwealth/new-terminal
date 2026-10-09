import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchAccountContext,
  fetchTerminalAccounts,
  setActiveAccount,
  subscribeToAccountContext,
  type AccountContext,
  type TerminalAccount,
} from "@/lib/terminalApi";

export const accountContextQueryKeys = {
  accounts: (userId: string) => ["customer-account", userId, "accounts"] as const,
  selection: (userId: string) => ["customer-account", userId, "selection"] as const,
  context: (userId: string, accountId: string) => ["customer-account", userId, "context", accountId] as const,
  terminal: (userId: string, resource: string, accountId: string) => ["customer-account", userId, "terminal", resource, accountId] as const,
};

export function resolveSelectedAccountId(accounts: readonly TerminalAccount[], requestedAccountId: string | null): string | null {
  if (requestedAccountId && accounts.some((account) => account.id === requestedAccountId)) return requestedAccountId;
  return accounts[0]?.id ?? null;
}

export interface CustomerAccountContextState {
  accounts: TerminalAccount[];
  accountContext: AccountContext | undefined;
  activeAccountId: string | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  hasNoAccount: boolean;
  selectAccount: (accountId: string) => Promise<void>;
}

export function useAccountContext(): CustomerAccountContextState {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const accountsQuery = useQuery({
    queryKey: userId ? accountContextQueryKeys.accounts(userId) : ["customer-account", "anonymous", "accounts"],
    queryFn: fetchTerminalAccounts,
    enabled: Boolean(userId),
    retry: false,
    staleTime: 30_000,
  });
  const accounts = useMemo(() => accountsQuery.data?.data ?? [], [accountsQuery.data?.data]);
  const selectionQuery = useQuery<string | null>({
    queryKey: userId ? accountContextQueryKeys.selection(userId) : ["customer-account", "anonymous", "selection"],
    queryFn: async () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  });
  const selectedAccountId = selectionQuery.data;
  const preferredAccountId = selectedAccountId ?? accountsQuery.data?.active_account_id ?? null;
  const activeAccountId = useMemo(() => resolveSelectedAccountId(accounts, preferredAccountId), [accounts, preferredAccountId]);

  useEffect(() => {
    if (selectedAccountId && !accounts.some((account) => account.id === selectedAccountId)) {
      queryClient.setQueryData(userId ? accountContextQueryKeys.selection(userId) : ["customer-account", "anonymous", "selection"], null);
    }
  }, [accounts, queryClient, selectedAccountId, userId]);

  const contextQuery = useQuery({
    queryKey: userId && activeAccountId ? accountContextQueryKeys.context(userId, activeAccountId) : ["customer-account", "anonymous", "context", "none"],
    queryFn: () => fetchAccountContext(activeAccountId as string),
    enabled: Boolean(userId && activeAccountId),
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!userId) return;
    return subscribeToAccountContext(() => {
      void queryClient.invalidateQueries({ queryKey: accountContextQueryKeys.accounts(userId) });
      void queryClient.invalidateQueries({ queryKey: ["customer-account", userId, "context"] });
    });
  }, [queryClient, userId]);

  const selectAccount = async (accountId: string) => {
    if (!userId) throw new Error("Authentication required to select a trading account");
    if (!accounts.some((account) => account.id === accountId)) throw new Error("Trading account is not available to the authenticated user");
    const selectionKey = accountContextQueryKeys.selection(userId);
    const previousSelection = queryClient.getQueryData<string | null>(selectionKey) ?? null;
    queryClient.setQueryData(selectionKey, accountId);
    try {
      await setActiveAccount(accountId);
      await queryClient.invalidateQueries({ queryKey: accountContextQueryKeys.context(userId, accountId) });
    } catch (error) {
      queryClient.setQueryData(selectionKey, previousSelection);
      throw error;
    }
  };

  const error = (accountsQuery.error ?? contextQuery.error) as Error | null;
  return {
    accounts,
    accountContext: contextQuery.data,
    activeAccountId,
    isLoading: accountsQuery.isLoading || (Boolean(activeAccountId) && contextQuery.isLoading),
    isError: accountsQuery.isError || contextQuery.isError,
    error,
    hasNoAccount: Boolean(userId && accountsQuery.isSuccess && accounts.length === 0),
    selectAccount,
  };
}