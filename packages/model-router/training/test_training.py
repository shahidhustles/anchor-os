"""Check the memory-saving loss against Qwen's full next-token loss."""
import unittest
import torch
from transformers import Qwen3Config, Qwen3ForCausalLM
from train import CompletionTrainer, Collator


class TrainingTests(unittest.TestCase):
    def test_completion_loss_matches_full_logits_and_gradients(self):
        torch.manual_seed(1)
        model = Qwen3ForCausalLM(Qwen3Config(vocab_size=32,hidden_size=16,intermediate_size=32,
            num_hidden_layers=1,num_attention_heads=2,num_key_value_heads=1,head_dim=8,
            attention_dropout=0.0,tie_word_embeddings=True))
        model.eval()
        batch = Collator(0)([
            {'input_ids':[1,2,3,4,5], 'attention_mask':[1]*5, 'labels':[-100,-100,-100,4,5]},
            {'input_ids':[1,6,7,8], 'attention_mask':[1]*4, 'labels':[-100,-100,7,8]},
        ])
        expected = model(**batch).loss
        expected.backward()
        gradient = model.lm_head.weight.grad.clone()
        model.zero_grad()
        actual = CompletionTrainer.compute_loss(None,model,dict(batch))
        actual.backward()
        torch.testing.assert_close(actual,expected)
        torch.testing.assert_close(model.lm_head.weight.grad,gradient)


if __name__ == '__main__':
    unittest.main()
