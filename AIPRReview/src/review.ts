import fetch from 'node-fetch';
import { git } from './git';
import { OpenAIApi } from 'openai';
import { addCommentToPR } from './pr';
import { Agent } from 'https';
import * as tl from "azure-pipelines-task-lib/task";

export async function reviewFile(targetBranch: string, fileName: string, httpsAgent: Agent, apiKey: string, openai: OpenAIApi | undefined, aoiEndpoint: string | undefined) {
  console.log(`Start reviewing ${fileName} ...`);

  const defaultOpenAIModel = 'gpt-4o';
  const patch = await git.diff([targetBranch, '--', fileName]);

  const instructions = `You are an AI code reviewer for a Pull Request in an Azure DevOps pipeline. Your task is to provide feedback on potential bugs, clean code issues, best practices, and performance considerations.
The Pull Request changes are provided in a patch format. Each patch entry includes the commit message in the Subject line, followed by the code changes (diffs) in a unidiff format.

As a code reviewer, your responsibilities are:
- Review only the added, edited, or deleted lines of code.
- If the changes are correct and there are no issues, respond with 'No feedback.'
- If you identify any bugs, incorrect code changes, deviations from best practices, or potential performance issues, provide detailed feedback explaining the concerns and suggesting improvements.

Your feedback should be clear, concise, and focused on helping improve the code quality, adherence to best practices, and performance.`;

  try {
    let choices: any;

    if (openai) {
      const response = await openai.createChatCompletion({
        model: tl.getInput('model') || defaultOpenAIModel,
        messages: [
          {
            role: "system",
            content: instructions
          },
          {
            role: "user",
            content: patch
          }
        ],
        max_tokens: 500
      });

      choices = response.data.choices
    }
    else if (aoiEndpoint) {
      const request = await fetch(aoiEndpoint, {
        method: 'POST',
        headers: { 'api-key': `${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `${instructions}\n, patch : ${patch}}`
          }]
        })
      });

      const response = await request.json();

      choices = response.choices;
    }

    if (choices && choices.length > 0) {
      const review = choices[0].message?.content as string;

      if (review.trim() !== "No feedback.") {
        await addCommentToPR(fileName, review, httpsAgent);
      }
    }

    console.log(`Review of ${fileName} completed.`);
  }
  catch (error: any) {
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }
  }
}
