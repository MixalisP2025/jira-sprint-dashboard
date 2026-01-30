# 🔧 Story Points Double-Counting Fix

## ⚠️ Problem Identified

Your Jira instance has **TWO** story points fields:

1. **`customfield_10054`** - "Story point estimate" (JSW standard field)
2. **`customfield_10050`** - "Story Points" (custom number field)

### The Issue:
The code was potentially:
- Using the wrong field
- Summing both fields (double-counting)
- Averaging both fields (halving the values)

This would cause incorrect story point totals across the dashboard.

## ✅ Solution Applied

### Priority Order (Pick ONE value per issue):

```javascript
Priority 1: customfield_10054 (Story point estimate - JSW)
Priority 2: customfield_10050 (Story Points - custom field)
Priority 3: Fallback to other fields
```

### Code Changes:

**1. Updated `src/utils/jiraService.js`:**
- Added proper field priority logic
- Only ONE value is extracted per issue
- Added debug logging to show which field was used
- Safe number parsing with null handling

**2. Updated `src/config/jiraConfig.js`:**
- Added `customfield_10054` to fields list
- Kept `customfield_10050` as fallback
- Both fields are fetched, but only one is used per issue

### Logic Flow:

```
For each issue:
  1. Check customfield_10054 (JSW Story point estimate)
     ✅ If exists and valid → USE THIS
  
  2. If not, check customfield_10050 (Story Points)
     ✅ If exists and valid → USE THIS
  
  3. If not, check fallback fields
     ✅ Use if available
  
  4. Otherwise → 0 story points
```

## 🔍 How to Verify the Fix

### After Refreshing from Jira:

1. **Open Browser Console (F12)**
2. **Look for debug logs:**
   ```
   Item 0 [PROJ-123] Story Points extraction:
     extractedSP: 5
     customfield_10054: 5
     customfield_10050: null
     whichFieldUsed: 'customfield_10054 (JSW)'
   ```

3. **Check the values:**
   - `whichFieldUsed` shows which field was used
   - `extractedSP` shows the final value
   - Both field values are shown for comparison

### Expected Results:

- ✅ Story points should match what you see in Jira
- ✅ No more double-counting or halving
- ✅ Consistent values across all team members
- ✅ Totals should add up correctly

## 📊 Impact on Dashboard

### Before Fix:
- Story points might be doubled (if summing both fields)
- Or halved (if averaging both fields)
- Inconsistent values across team members

### After Fix:
- ✅ Accurate story points from single source
- ✅ Consistent calculation method
- ✅ Matches Jira UI values
- ✅ Correct capacity calculations

## 🧪 Testing Checklist

- [ ] Refresh from Jira
- [ ] Check console logs for "whichFieldUsed"
- [ ] Verify story points match Jira UI
- [ ] Check team member totals
- [ ] Verify capacity calculations
- [ ] Compare with .txt file upload (should match)

## 🔄 Next Steps

1. **Refresh from Jira** to get fresh data with the fix
2. **Check console logs** to see which field is being used
3. **Verify totals** match your expectations
4. **Compare with Jira UI** to confirm accuracy

## 📝 Technical Details

### Safe Number Parsing:
```javascript
const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
```

### Field Priority Logic:
```javascript
const sp54 = toNumber(fields.customfield_10054);
if (sp54 !== null) {
  storyPoints = sp54;  // Use JSW field
} else {
  const sp50 = toNumber(fields.customfield_10050);
  if (sp50 !== null) {
    storyPoints = sp50;  // Use custom field
  } else {
    storyPoints = 0;  // No story points
  }
}
```

## ⚠️ Important Notes

- **Only ONE field is used per issue** - no summing or averaging
- **JSW field takes priority** - this is the standard Jira Software field
- **Custom field is fallback** - used if JSW field is empty
- **Debug logs show which field** - for transparency and verification

---

**Status**: ✅ Fix Applied - Ready to Test

Refresh from Jira to see the corrected story points!
