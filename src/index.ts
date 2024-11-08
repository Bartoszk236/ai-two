import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';
import {SearchHit} from "@elastic/elasticsearch/lib/api/types";

// Ignorowanie weryfikacji certyfikatu SSL w środowisku testowym
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

dotenv.config();

const folderPath = './requests'; // Ścieżka do folderu z plikami .txt
const openaiApiUrl = 'https://api.openai.com/v1/embeddings';
const elasticsearchUrl = 'https://localhost:9200'; // Używamy https
const elasticsearchIndex = 'my_vector_index';

// Pobieranie klucza API OpenAI i danych uwierzytelniających Elasticsearch z .env
const openaiApiKey = process.env.OPENAI_API_KEY;
const elasticUsername = process.env.ELASTIC_USERNAME || 'elastic';
const elasticPassword = process.env.ELASTIC_PASSWORD || 'your_password_here';

// Konfiguracja klienta Elasticsearch z uwierzytelnianiem
const client = new Client({
    node: elasticsearchUrl,
    auth: {
        username: elasticUsername,
        password: elasticPassword,
    }
});

// Funkcja do generowania wektora przy użyciu OpenAI API
async function generateVector(text: string): Promise<number[]> {
    try {
        const response = await axios.post(
            openaiApiUrl,
            {
                model: 'text-embedding-ada-002',
                input: text,
            },
            {
                headers: {
                    Authorization: `Bearer ${openaiApiKey}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        return response.data.data[0].embedding; // Zwraca wygenerowany wektor
    } catch (error) {
        console.error('Error generating vector:', error);
        return [];
    }
}

// Funkcja do indeksowania dokumentu w Elasticsearch
async function indexDocument(filename: string, vector: number[], fileContent: string) {
    try {
        await client.index({
            index: elasticsearchIndex,
            document: {
                name: filename,
                vector_field: vector,
                content: fileContent
            },
        });
        console.log(`Indexed document: ${filename}`);
    } catch (error) {
        console.error(`Error indexing document ${filename}:`, error);
    }
}

// Funkcja główna do przetwarzania plików i indeksowania
async function processFiles() {
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
        const filePath = path.join(folderPath, file);
        const fileContent = fs.readFileSync(filePath, 'utf-8');

        // Generowanie wektora dla zawartości pliku
        const vector = await generateVector(fileContent);
        if (vector.length === 0) {
            console.error(`Skipping file ${file} due to vector generation error.`);
            continue;
        }

        // Indeksowanie dokumentu z wektorem w Elasticsearch
        await indexDocument(file, vector, fileContent);
    }
}

type MyIndexDocument = {
    name: string,
    vector_field: any,
    content: string

}

// Funkcja do wyszukiwania dokumentów podobnych do zadanego wektora
async function searchSimilarDocuments(queryText: string) {
    // Generowanie wektora dla tekstu zapytania
    const queryVector = await generateVector(queryText);
    if (queryVector.length === 0) {
        console.error('Error generating vector for query text.');
        return;
    }

    try {
        // Wyszukiwanie podobnych dokumentów w Elasticsearch
        const result = await client.search({
            index: elasticsearchIndex,
            size: 1, // Liczba zwróconych dokumentów
            query: {
                script_score: {
                    query: {
                        match_all: {}, // Wyszukaj we wszystkich dokumentach
                    },
                    script: {
                        source: "cosineSimilarity(params.query_vector, 'vector_field') + 1.0",
                        params: {
                            query_vector: queryVector,
                        },
                    },
                },
            },
        });

        // Wyświetlanie wyników
        console.log('Similar documents:');
        result.hits.hits.forEach((hit) => {
            console.log(`Document ID: ${hit._id}, Score: ${hit._score}`);
            // @ts-ignore
            console.log(hit._source.content);
        });
    } catch (error) {
        console.error('Error searching for similar documents:', error);
    }
}

// Uruchomienie programu
// processFiles().catch((error) => console.error('Error processing files:', error));
const queryText = 'Co lubi robić Staś?';
searchSimilarDocuments(queryText).catch((error) => console.error('Error in searchSimilarDocuments:', error));