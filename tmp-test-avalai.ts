import { avalaiClient, TEXT_MODEL } from "./src/lib/fitness/ai";

async function main() {
  console.log("Testing AvalAI text generation...");
  console.log("Model:", TEXT_MODEL);
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: "تو یک دستیار فارسی هستی." },
        { role: "user", content: "یک پاراگراف کوتاه درباره ورزش بنویس." },
      ],
      max_tokens: 200,
      temperature: 0.7,
    } as any);
    console.log("Response:", completion.choices[0]?.message?.content);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}
main().finally(() => process.exit(0));
