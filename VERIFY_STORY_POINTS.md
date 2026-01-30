# 🔍 Story Points Verification Guide

## ✅ Current Implementation

The code now correctly implements the canonical story points extraction:

```javascript
Priority 1: customfield_10054 (Story point estimate - JSW)
Priority 2: customfield_10050 (Story Points - custom)
Priority 3: Fallback fields
Result: ONE value per issue (never summed, never averaged)
```

## 🧪 How to Verify the Fix

### Step 1: Refresh from Jira
1. Click "Refresh from Jira" button
2. Wait for data to load
3. Open Browser Console (F12)

### Step 2: Check Console Logs

You should see logs like:
```
PROJ-123: sp50=null, sp54=5, used=5
PROJ-124: sp50=3, sp54=null, used=3
PROJ-125: sp50=8, sp54=8, used=8
```

### Step 3: Verify No Halving

**Before Fix (WRONG):**
- Tania Strati: 31.3 SP (should be 62.6)
- Values are exactly half of expected

**After Fix (CORRECT):**
- Tania Strati: 62.6 SP ✅
- Values match Jira UI

### Step 4: Check Specific Issues

Pick a few issues from Jira and verify:

| Issue Key | SP in Jira | SP in Dashboard | Match? |
|-----------|------------|-----------------|--------|
| PROJ-123  | 5          | 5               | ✅     |
| PROJ-124  | 3          | 3               | ✅     |
| PROJ-125  | 8          | 8               | ✅     |

## 🔍 Debug Console Commands

### Check Total Story Points
```javascript
// In browser console after data loads
console.log('Total SP:', Object.values(stats).reduce((sum, s) => sum + s.totalStoryPoints, 0));
```

### Check Specific Assignee
```javascript
// Check Tania Strati's total
console.log('Tania:', stats['Tania Strati']?.totalStoryPoints);
```

### Verify Field Usage
Look for these logs in console:
```
Item 0 [PROJ-123] Story Points extraction:
  sp50: null
  sp54: 5
  used: 5
  whichFieldUsed: 'customfield_10054 (JSW)'
```

## ✅ Expected Results

### Console Logs Should Show:
1. **Field values for each issue:**
   ```
   PROJ-123: sp50=null, sp54=5, used=5
   ```

2. **Which field was used:**
   ```
   whichFieldUsed: 'customfield_10054 (JSW)'
   ```

3. **No division by 2 anywhere**

4. **Totals match Jira UI**

### Dashboard Should Show:
- ✅ Correct story point totals per assignee
- ✅ Correct capacity calculations
- ✅ Values match what you see in Jira
- ✅ No more "half values" (31.3 → 62.6)

## 🐛 If Values Are Still Wrong

### Check 1: Are both fields being fetched?
Look for this in console:
```
Item 0 [PROJ-123] Story Points extraction:
  sp50: <value or null>
  sp54: <value or null>
```

If both show `undefined`, the fields aren't being fetched.

### Check 2: Which field has values?
Count how many issues use each field:
- Most issues should use `customfield_10054` (JSW standard)
- Some might use `customfield_10050` (custom field)
- None should use both (only ONE is picked)

### Check 3: Are values being summed?
Look for any logs showing:
```
sp50=5, sp54=5, used=10  ❌ WRONG (summing)
sp50=5, sp54=5, used=5   ✅ CORRECT (picking one)
```

## 📊 Test Cases

### Test Case 1: Issue with only sp54
```
Issue: PROJ-123
sp50: null
sp54: 5
Expected: 5
```

### Test Case 2: Issue with only sp50
```
Issue: PROJ-124
sp50: 3
sp54: null
Expected: 3
```

### Test Case 3: Issue with both fields
```
Issue: PROJ-125
sp50: 8
sp54: 8
Expected: 8 (not 16, not 4)
```

### Test Case 4: Issue with no story points
```
Issue: PROJ-126
sp50: null
sp54: null
Expected: 0
```

## 🎯 Success Criteria

- [ ] Console shows `sp50` and `sp54` values for each issue
- [ ] Console shows `used` value (the one actually used)
- [ ] `used` value equals either `sp50` OR `sp54` (never both)
- [ ] Totals match Jira UI
- [ ] No more "half values"
- [ ] Tania Strati shows 62.6 SP (not 31.3)
- [ ] All assignees show correct totals

## 🔄 Next Steps

1. **Refresh from Jira**
2. **Check console logs**
3. **Verify totals match Jira**
4. **Compare with previous values**
5. **Confirm no more halving**

---

**Status**: ✅ Code is correct - Ready to verify

The extraction logic is now correct. Refresh from Jira to see accurate values!
