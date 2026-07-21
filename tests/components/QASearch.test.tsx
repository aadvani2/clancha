import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QASearch } from "@/components/channel/QASearch";

// Mock the toast hook
vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

describe("QASearch component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("should render collapsed by default", () => {
    render(<QASearch channelId="test-channel" />);
    expect(
      screen.getByText("Ask about this conversation")
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ask a question/i)).not.toBeInTheDocument();
  });

  it("should expand when header is clicked", async () => {
    render(<QASearch channelId="test-channel" />);
    const header = screen.getByText("Ask about this conversation");
    await userEvent.click(header);
    expect(
      screen.getByPlaceholderText(/ask a question/i)
    ).toBeInTheDocument();
  });

  it("should show disabled placeholder when disabled", async () => {
    render(<QASearch channelId="test-channel" disabled />);
    const header = screen.getByText("Ask about this conversation");
    await userEvent.click(header);
    expect(
      screen.getByPlaceholderText(/not available for view-only/i)
    ).toBeInTheDocument();
  });

  it("should disable submit button when textarea is empty", async () => {
    render(<QASearch channelId="test-channel" />);
    await userEvent.click(screen.getByText("Ask about this conversation"));
    const submitButton = screen.getByRole("button", { name: /search ai/i });
    expect(submitButton).toBeDisabled();
  });

  it("should enable submit button when textarea has content", async () => {
    render(<QASearch channelId="test-channel" />);
    await userEvent.click(screen.getByText("Ask about this conversation"));
    const textarea = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(textarea, "Test question");
    const submitButton = screen.getByRole("button", { name: /search ai/i });
    expect(submitButton).not.toBeDisabled();
  });

  it("should submit question and display answer", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ answer: "Test answer" }),
    });

    render(<QASearch channelId="test-channel" />);
    await userEvent.click(screen.getByText("Ask about this conversation"));
    const textarea = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(textarea, "What is the answer?");
    await userEvent.click(screen.getByRole("button", { name: /search ai/i }));

    await waitFor(() => {
      expect(screen.getByText("Test answer")).toBeInTheDocument();
    });
  });

  it("should show loading state during submission", async () => {
    let resolvePromise: (value: unknown) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    render(<QASearch channelId="test-channel" />);
    await userEvent.click(screen.getByText("Ask about this conversation"));
    const textarea = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(textarea, "What is the answer?");
    await userEvent.click(screen.getByRole("button", { name: /search ai/i }));

    expect(screen.getByText(/searching/i)).toBeInTheDocument();

    resolvePromise!({
      ok: true,
      json: () => Promise.resolve({ answer: "Test answer" }),
    });
  });

  it("should clear question and answer when clear button is clicked", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ answer: "Test answer" }),
    });

    render(<QASearch channelId="test-channel" />);
    await userEvent.click(screen.getByText("Ask about this conversation"));
    const textarea = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(textarea, "What is the answer?");
    await userEvent.click(screen.getByRole("button", { name: /search ai/i }));

    await waitFor(() => {
      expect(screen.getByText("Test answer")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.queryByText("Test answer")).not.toBeInTheDocument();
    expect(textarea).toHaveValue("");
  });

  it("should call API with correct parameters", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ answer: "Test answer" }),
    });

    render(<QASearch channelId="my-channel-123" />);
    await userEvent.click(screen.getByText("Ask about this conversation"));
    const textarea = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(textarea, "My question");
    await userEvent.click(screen.getByRole("button", { name: /search ai/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channelId: "my-channel-123",
          question: "My question",
        }),
      });
    });
  });
});
