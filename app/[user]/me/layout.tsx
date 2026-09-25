import JournalLocaleProvider from "@/components/JournalLocaleProvider";

/**
 * A reader's own page under its own strings — the sign-in, contact and helper
 * words it carries are more than every reader page of the journal together,
 * so they ship here rather than with the journal layout's.
 */
export default async function MeLayout({ children, params }: LayoutProps<"/[user]/me">) {
  const { user } = await params;
  return (
    <JournalLocaleProvider username={user} scope="me">
      {children}
    </JournalLocaleProvider>
  );
}
