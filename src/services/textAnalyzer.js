const natural = require('natural');
const { Configuration, OpenAIApi } = require('openai');

// Initialize OpenAI
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Initialize Natural NLP tools
const tokenizer = new natural.WordTokenizer();
const TfIdf = natural.TfIdf;

class TextAnalyzer {
  async extractKeywords(description) {
    try {
      // Use GPT to enhance keyword extraction
      const gptResponse = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: `Extract the most important keywords from this text for video content creation: ${description}`,
        max_tokens: 100,
        temperature: 0.5,
      });

      const gptKeywords = gptResponse.data.choices[0].text
        .trim()
        .split('\n')
        .map(k => k.trim())
        .filter(k => k.length > 0);

      // Use TF-IDF for additional keyword extraction
      const tfidf = new TfIdf();
      tfidf.addDocument(description);

      // Tokenize the text
      const tokens = tokenizer.tokenize(description.toLowerCase());

      // Remove stopwords and short words
      const stopwords = natural.stopwords;
      const filteredTokens = tokens.filter(token => 
        token.length > 2 && !stopwords.includes(token)
      );

      // Get unique keywords
      const keywords = new Set([...gptKeywords, ...filteredTokens]);

      // Convert Set back to array and limit to top 10 keywords
      return Array.from(keywords).slice(0, 10);
    } catch (error) {
      console.error('Error in keyword extraction:', error);
      throw error;
    }
  }
}

module.exports = new TextAnalyzer();